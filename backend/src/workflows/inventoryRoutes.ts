import {
  addressSchema,
  automationChainFor,
  fundsChainIdSchema,
  networkModeSchema,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowArchiveMessage,
  workflowArchiveRequestSchema,
  workflowArchiveStateSchema,
  workflowIdSchema,
  workflowListPageSchema,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  type Address,
  type FundsChainId,
  type NetworkMode,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { zeroAddress, type Hex } from 'viem';
import { z } from 'zod';

import { clientFor, type ChainClients } from '../chain/clients.js';
import { verifyWalletSignature } from '../chain/verifySignature.js';
import { workflowConfirmationDepth } from './finality.js';
import {
  bidirectionalPage,
  encodePageCursor,
  pageScope,
  readPageCursor,
  workflowPageSize,
} from './pagination.js';

const ownerQuery = z.object({
  owner: addressSchema,
  network: networkModeSchema.default('testnet'),
});
const workflowQuery = ownerQuery.extend({
  chain: z.coerce.number().pipe(fundsChainIdSchema),
  workflow: workflowIdSchema,
});
const listQuery = ownerQuery.extend({
  scope: z.enum(['current', 'archived']).default('current'),
  after: z.string().max(300).optional(),
});
const listCursor = z.object({
  chain: fundsChainIdSchema,
  id: workflowIdSchema,
  before: z.boolean(),
});
const databasePage = workflowListPageSchema.pick({ items: true, total: true, syncing: true });
const writeBody = workflowArchiveRequestSchema
  .extend({
    signature: z
      .string()
      .max(8194)
      .regex(/^0x(?:[\da-f]{2})+$/i)
      .transform((value) => value as Hex),
  })
  .strict();

export interface WorkflowInventoryOptions {
  readonly clients: ChainClients;
  readonly corsOrigins: readonly string[];
  readonly vaultFactories: Partial<Record<FundsChainId, Address>>;
}

export function registerWorkflowInventoryRoutes(
  app: FastifyInstance,
  db: SupabaseClient,
  resolve: (network: NetworkMode) => {
    address: Address | undefined;
    deployment: string | null;
    chains: readonly FundsChainId[];
  },
  options?: WorkflowInventoryOptions,
) {
  const limits = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const archiveColumns = 'archived,revision,epoch::text';
  const emptyState = { archived: false, revision: 0, epoch: null };

  app.get('/v3/workflows', limits, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const input = listQuery.safeParse(request.query);
    if (!input.success) return reply.code(400).send({ message: 'Check the workflow filters.' });
    const { network, scope, after } = input.data;
    const owner = input.data.owner.toLowerCase();
    const { deployment, chains } = resolve(network);
    const empty = { items: [], nextCursor: null, previousCursor: null, total: 0, syncing: false };
    if (!deployment) return empty;
    const selected = options ? chains.filter((chain) => options.vaultFactories[chain]) : chains;
    if (!selected.length) return empty;
    const scopeKey = pageScope('workflows', deployment, owner, selected, scope);
    let cursor;
    try {
      cursor = after ? readPageCursor(after, listCursor, scopeKey) : undefined;
    } catch {
      return reply.code(400).send({ message: 'This workflow page link is invalid.' });
    }
    const { data, error } = await db.rpc('workflow_v2_inventory_page', {
      p_deployment: deployment,
      p_owner: owner,
      p_chains: selected,
      p_archived: scope === 'archived',
      p_cursor_chain: cursor?.chain ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_before: cursor?.before ?? false,
      p_limit: workflowPageSize + 1,
    });
    if (error) throw error;
    const page = databasePage.parse(data);
    return {
      ...page,
      ...bidirectionalPage(page.items, cursor, (row, before) =>
        encodePageCursor(scopeKey, { ...row, before }),
      ),
    };
  });

  app.get('/v3/workflows/archive', limits, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const input = workflowQuery.safeParse(request.query);
    if (!input.success) return reply.code(400).send({ message: 'Check the workflow link.' });
    const { network, chain, owner, workflow } = input.data;
    const { deployment, chains } = resolve(network);
    if (!deployment || !chains.includes(chain)) return emptyState;
    const { data, error } = await db
      .from('workflow_v2_archive_events')
      .select(archiveColumns)
      .match({ deployment, chain, owner: owner.toLowerCase(), workflow_id: workflow.toLowerCase() })
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? workflowArchiveStateSchema.parse(data) : emptyState;
  });

  app.post(
    '/v3/workflows/archive',
    {
      bodyLimit: 10_000,
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const input = writeBody.safeParse(request.body);
      if (!input.success)
        return reply.code(400).send({ message: 'Check the workflow archive request.' });
      const { signature, ...change } = input.data;
      const { network, chain, owner, workflow, action, epoch, expires, revision } = change;
      const origin = request.headers.origin;
      if (!options || !origin || !options.corsOrigins.includes(origin)) {
        return reply.code(403).send({ message: 'This origin cannot manage workflows.' });
      }
      const { deployment, address, chains } = resolve(network);
      const factory = options.vaultFactories[chain];
      if (!deployment || !address || !factory || !chains.includes(chain)) {
        return reply.code(400).send({ message: 'This workflow network is unavailable.' });
      }
      const now = Math.floor(Date.now() / 1000);
      if (expires <= now || expires > now + 300) {
        return reply.code(400).send({ message: 'Sign a fresh workflow request.' });
      }
      const automationChain = automationChainFor(network);
      if (
        !(await verifyWalletSignature(
          options.clients,
          {
            address: owner,
            message: workflowArchiveMessage(change, origin, deployment),
            signature,
          },
          automationChain,
        ))
      ) {
        return reply.code(401).send({ message: 'The connected wallet must sign this request.' });
      }
      const automation = clientFor(options.clients, automationChain);
      const settlement = clientFor(options.clients, chain);
      const [agent, vault] = await Promise.all([
        automation.readContract({
          address,
          abi: workflowAgentFactoryV2Abi,
          functionName: 'agentOf',
          args: [owner],
        }),
        settlement.readContract({
          address: factory,
          abi: workflowVaultFactoryV2Abi,
          functionName: 'vaultOf',
          args: [owner],
        }),
      ]);
      if (agent === zeroAddress || vault === zeroAddress) {
        return reply.code(404).send({ message: 'This wallet does not own the workflow.' });
      }
      const readAuthorization = (blockNumber?: bigint) =>
        settlement.readContract({
          address: vault,
          abi: workflowVaultV2Abi,
          functionName: 'authorizations',
          args: [workflow],
          blockNumber,
        });
      const readEntry = (blockNumber?: bigint) =>
        automation.readContract({
          address: agent,
          abi: workflowAgentV2Abi,
          functionName: 'entries',
          args: [workflow],
          blockNumber,
        });
      const [authorization, entry] = await Promise.all([readAuthorization(), readEntry()]);
      if (authorization[1] === 0n) return reply.code(404).send({ message: 'Workflow not found.' });
      if (
        authorization[1].toString() !== epoch ||
        authorization[3] ||
        (entry[5] === chain && entry[4] !== 0)
      ) {
        return reply.code(409).send({
          message: 'The workflow changed. Refresh and make sure it is paused before trying again.',
        });
      }
      const archived = action === 'archive';
      if (archived) {
        const [vaultHead, agentHead] = await Promise.all([
          settlement.getBlockNumber({ cacheTime: 0 }),
          automation.getBlockNumber({ cacheTime: 0 }),
        ]);
        const confirmedVaultBlock = vaultHead - workflowConfirmationDepth(chain);
        const confirmedAgentBlock = agentHead - workflowConfirmationDepth(automationChain);
        const awaitingConfirmations = () =>
          reply
            .code(425)
            .send({ message: 'Waiting for both networks to confirm the workflow is paused.' });
        if (confirmedVaultBlock < authorization[2] || confirmedAgentBlock < 0n)
          return awaitingConfirmations();
        const [confirmedAuthorization, confirmedEntry] = await Promise.all([
          readAuthorization(confirmedVaultBlock),
          readEntry(confirmedAgentBlock).catch(async (cause: unknown) => {
            // An Agent created after the confirmation boundary has no historical entry yet.
            const code = await automation.getCode({
              address: agent,
              blockNumber: confirmedAgentBlock,
            });
            if (!code || code === '0x') return undefined;
            throw cause;
          }),
        ]);
        if (
          confirmedAuthorization[1] !== authorization[1] ||
          confirmedAuthorization[3] ||
          (confirmedEntry?.[5] === chain && confirmedEntry[4] !== 0)
        ) {
          return awaitingConfirmations();
        }
      }
      const { data, error } = await db.rpc('workflow_v2_write_archive', {
        p_deployment: deployment,
        p_chain: chain,
        p_owner: owner.toLowerCase(),
        p_workflow: workflow.toLowerCase(),
        p_revision: revision,
        p_epoch: epoch,
        p_archived: archived,
      });
      if (error) throw error;
      if (!data)
        return reply.code(409).send({ message: 'The archive changed. Refresh and try again.' });
      return workflowArchiveStateSchema.parse({ archived, revision: revision + 1, epoch });
    },
  );
}
