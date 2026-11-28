import {
  addressSchema,
  automationChainFor,
  demoAccountConfigSchema,
  demoFeaturedRunLimit,
  fundsChainIdSchema,
  fundsChainsFor,
  networkModeSchema,
  workflowDeploymentKey,
  workflowHealthResponseSchema,
  workflowIdSchema,
  workflowActivityFilterSchema,
  workflowActivityStatuses,
  workflowV2RunProofSchema,
  workflowV2RunStatusSchema,
  workflowV2Trigger,
  type Address,
  type NetworkMode,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { zeroHash, type Hex } from 'viem';
import { z } from 'zod';

import type { CallbackReader } from '../chain/lasnaCallbacks.js';
import { workflowV2FailureReason } from './failureReasons.js';
import {
  registerWorkflowInventoryRoutes,
  type WorkflowInventoryOptions,
} from './inventoryRoutes.js';
import {
  bidirectionalPage,
  encodePageCursor,
  pageScope,
  readPageCursor,
  workflowPageSize,
} from './pagination.js';
const settlementChain = fundsChainIdSchema;
const cursor = z.object({
  block: z.number().int().nonnegative().safe(),
  id: workflowIdSchema,
  chain: settlementChain,
  before: z.boolean().optional(),
});

const query = z.object({
  owner: addressSchema,
  id: workflowIdSchema.optional(),
  workflow: workflowIdSchema.optional(),
  chain: z.coerce.number().pipe(settlementChain).optional(),
  after: z.string().max(250).optional(),
  network: networkModeSchema.default('testnet'),
  status: workflowActivityFilterSchema.default('all'),
});
const listingId = z.string().regex(/^[1-9]\d{0,77}$/);
const triggerCode = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const marketplaceTriggerFilter = z.enum(['schedule', 'payment', 'price', 'transfer']);
const listing = z.object({
  id: listingId,
  owner: addressSchema,
  agent: addressSchema,
  workflow_id: workflowIdSchema,
  program_hash: workflowIdSchema,
  program: z.string().regex(/^0x[\da-f]+$/i),
  chain: settlementChain,
  origin_chain: settlementChain,
  trigger: triggerCode.nullable(),
  title: z.string(),
  description: z.string(),
  block_number: z.number().int().safe(),
  log_index: z.number().int().nonnegative(),
  verified_runs: z.number().int().nonnegative().default(0),
});
const marketCursor = z.object({
  block: z.number().int().nonnegative().safe(),
  index: z.number().int().nonnegative().max(2_147_483_647),
});
const run = z.object({
  id: workflowIdSchema,
  workflow_id: workflowIdSchema,
  agent: addressSchema,
  title: z.string(),
  chain: settlementChain,
  program_hash: workflowIdSchema,
  epoch: z.string(),
  origin_chain: z.number().int(),
  origin_transaction: workflowIdSchema,
  origin_log_index: z.string(),
  lasna_transaction: workflowIdSchema,
  lasna_block: z.number().int().nonnegative().safe(),
  expires_at: z.number().int().nonnegative().safe(),
  destination_transaction: workflowIdSchema.nullable(),
  reason: z.string().nullable(),
  path: z.number().int().nonnegative().nullable(),
  status: workflowV2RunStatusSchema,
});
const healthRow = z.object({
  chain: settlementChain,
  workflow_id: workflowIdSchema,
  last_run_id: workflowIdSchema.nullable(),
  last_status: workflowV2RunStatusSchema.nullable(),
  last_reason: z.string().nullable(),
  last_expires_at: z.number().int().nonnegative().safe().nullable(),
  last_path: z.number().int().nonnegative().nullable(),
  last_lasna_transaction: workflowIdSchema.nullable(),
  last_destination_transaction: workflowIdSchema.nullable(),
  last_success_id: workflowIdSchema.nullable(),
  last_success_path: z.number().int().nonnegative().nullable(),
  last_success_lasna_transaction: workflowIdSchema.nullable(),
  last_success_destination_transaction: workflowIdSchema.nullable(),
  pending_run_id: workflowIdSchema.nullable(),
  pending_expires_at: z.number().int().nonnegative().safe().nullable(),
});
const proofRow = run
  .pick({
    id: true,
    chain: true,
    program_hash: true,
    origin_chain: true,
    origin_transaction: true,
    origin_log_index: true,
    lasna_transaction: true,
    destination_transaction: true,
    expires_at: true,
    status: true,
    path: true,
    reason: true,
  })
  .extend({
    agent: addressSchema.optional(),
  });
const proofColumns = Object.keys(proofRow.shape).join(',');
const demoRunRow = z.object({
  id: workflowIdSchema,
  workflow_id: workflowIdSchema,
  title: z.string(),
  chain: settlementChain,
  origin_chain: z.number().int(),
  status: workflowV2RunStatusSchema,
  path: z.number().int().nonnegative().nullable(),
});
const demoRunColumns = Object.keys(demoRunRow.shape).join(',');
const routeRateLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } } as const;

function runProof(row: z.infer<typeof proofRow>) {
  return workflowV2RunProofSchema.parse({
    id: row.id,
    chain: row.chain,
    programHash: row.program_hash,
    originChain: row.origin_chain,
    originTransaction: row.origin_transaction,
    originLogIndex: row.origin_log_index,
    lasnaTransaction: row.lasna_transaction,
    destinationTransaction: row.destination_transaction,
    expiresAt: row.expires_at,
    status: row.status,
    path: row.path,
    reason: row.reason ? workflowV2FailureReason(row.reason).message : null,
  });
}

export function registerWorkflowV2Routes(
  app: FastifyInstance,
  db: SupabaseClient,
  factoryOrDeployments: Address | { testnet?: Address; mainnet?: Address },
  callbackReaders?: Partial<Record<NetworkMode, CallbackReader>>,
  demoConfig?: { readonly owner?: Address; readonly featuredRunIds?: readonly Hex[] },
  inventory?: WorkflowInventoryOptions,
) {
  function resolveDeployment(network: NetworkMode) {
    const address =
      typeof factoryOrDeployments === 'string'
        ? network === 'testnet'
          ? factoryOrDeployments
          : undefined
        : network === 'mainnet'
          ? factoryOrDeployments.mainnet
          : factoryOrDeployments.testnet;
    return {
      address,
      deployment: address ? workflowDeploymentKey(automationChainFor(network), address) : null,
      chains: fundsChainsFor(network),
    };
  }

  registerWorkflowInventoryRoutes(app, db, resolveDeployment, inventory);

  app.get('/v3/demo', routeRateLimit, async (request, reply) => {
    const params = z
      .object({ network: networkModeSchema.default('testnet') })
      .safeParse(request.query);
    if (!params.success) return reply.code(400).send({ message: 'Check the network parameter.' });
    const network = params.data.network;
    if (network !== 'testnet' || !demoConfig?.owner) {
      reply.header('cache-control', 'no-store');
      return demoAccountConfigSchema.parse({
        available: false,
        owner: null,
        network,
        featuredRuns: [],
      });
    }
    const { deployment, chains } = resolveDeployment('testnet');
    if (!deployment) {
      reply.header('cache-control', 'no-store');
      return demoAccountConfigSchema.parse({
        available: false,
        owner: null,
        network,
        featuredRuns: [],
      });
    }
    let featuredQuery = db
      .from('workflow_v2_activity')
      .select(demoRunColumns)
      .match({ deployment, owner: demoConfig.owner.toLowerCase() })
      .in('chain', [...chains]);
    if (demoConfig.featuredRunIds?.length) {
      featuredQuery = featuredQuery.in('id', [...demoConfig.featuredRunIds]);
    } else {
      featuredQuery = featuredQuery.eq('status', 'confirmed');
    }
    const { data, error } = await featuredQuery
      .order('lasna_block', { ascending: false })
      .order('id', { ascending: false })
      .limit(demoFeaturedRunLimit);
    if (error) throw error;
    const featuredRuns = z
      .array(demoRunRow)
      .parse(data ?? [])
      .map((row) => ({
        id: row.id,
        workflowId: row.workflow_id,
        title: row.title,
        chain: row.chain,
        originChain: row.origin_chain,
        status: row.status,
        path: row.path,
      }));
    reply.header('cache-control', 'public, max-age=30');
    return demoAccountConfigSchema.parse({
      available: true,
      owner: demoConfig.owner,
      network: 'testnet',
      featuredRuns,
    });
  });

  app.get('/v3/marketplace', routeRateLimit, async (request, reply) => {
    const params = z
      .object({
        q: z.string().max(160).default(''),
        after: z.string().max(300).optional(),
        network: networkModeSchema.default('testnet'),
        chain: z.coerce.number().int().optional(),
        crossChain: z.enum(['true', 'false']).optional(),
        trigger: marketplaceTriggerFilter.optional(),
      })
      .safeParse(request.query);
    if (!params.success) return reply.code(400).send({ message: 'Check the search parameters.' });
    const { deployment, chains } = resolveDeployment(params.data.network);
    const selectedChains =
      params.data.chain === undefined
        ? [...chains]
        : chains.some((candidate) => candidate === params.data.chain)
          ? [params.data.chain]
          : null;
    if (!selectedChains) return reply.code(400).send({ message: 'Check the search parameters.' });
    if (!deployment) return { listings: [], nextCursor: null };
    const trimmed = params.data.q.trim();
    const scope = pageScope(
      'marketplace',
      deployment,
      selectedChains,
      trimmed,
      params.data.crossChain,
      params.data.trigger,
    );
    let before;
    if (params.data.after) {
      try {
        before = readPageCursor(params.data.after, marketCursor, scope, true);
      } catch {
        return reply.code(400).send({ message: 'This Marketplace page link is invalid.' });
      }
    }
    const limit = workflowPageSize;
    const { data, error } = await db.rpc('workflow_v2_marketplace_browse', {
      p_deployment: deployment,
      p_chains: selectedChains,
      p_query: trimmed || null,
      p_cross_chain:
        params.data.crossChain === undefined ? null : params.data.crossChain === 'true',
      p_trigger: params.data.trigger ? workflowV2Trigger[params.data.trigger] : null,
      p_before_block: before?.block ?? null,
      p_before_index: before?.index ?? null,
      p_limit: limit + 1,
    });
    if (error) throw error;
    const rows = z.array(listing).parse(data ?? []);
    const last = rows[limit - 1];
    return {
      listings: rows.slice(0, limit),
      nextCursor:
        last && rows.length > limit
          ? encodePageCursor(scope, { block: last.block_number, index: last.log_index })
          : null,
    };
  });

  app.get('/v3/marketplace/:id', routeRateLimit, async (request, reply) => {
    const params = z.object({ id: listingId }).safeParse(request.params);
    const networkQuery = z
      .object({ network: networkModeSchema.default('testnet') })
      .safeParse(request.query);
    if (!params.success || !networkQuery.success)
      return reply.code(400).send({ message: 'This listing ID is invalid.' });
    const { deployment, chains } = resolveDeployment(networkQuery.data.network);
    if (!deployment) return reply.code(404).send({ message: 'This listing is unavailable.' });
    const { data, error } = await db.rpc('workflow_v2_marketplace_listing', {
      p_deployment: deployment,
      p_id: params.data.id,
      p_chains: [...chains],
    });
    if (error) throw error;
    const rows = z.array(listing).parse(data ?? []);
    const item = rows[0];
    return item ? item : reply.code(404).send({ message: 'This listing is unavailable.' });
  });

  app.get('/v3/health', routeRateLimit, async (request, reply) => {
    const input = z
      .object({ owner: addressSchema, network: networkModeSchema.default('testnet') })
      .safeParse(request.query);
    if (!input.success) return reply.code(400).send({ message: 'Check the wallet address.' });
    const { deployment, chains } = resolveDeployment(input.data.network);
    if (!deployment) return workflowHealthResponseSchema.parse({ workflows: [] });
    const { data, error } = await db.rpc('workflow_v2_health', {
      p_deployment: deployment,
      p_owner: input.data.owner,
      p_chains: [...chains],
    });
    if (error) throw error;
    const rows = z.array(healthRow).parse(data);
    return workflowHealthResponseSchema.parse({
      workflows: rows.map((row) => {
        const failure = row.last_reason ? workflowV2FailureReason(row.last_reason) : undefined;
        return {
          chain: row.chain,
          workflowId: row.workflow_id,
          lastRun:
            row.last_run_id && row.last_status && row.last_lasna_transaction
              ? {
                  id: row.last_run_id,
                  status: row.last_status,
                  reason: failure?.message ?? null,
                  reasonCode: row.last_reason,
                  recovery: failure?.recovery ?? null,
                  lasnaTransaction: row.last_lasna_transaction,
                  destinationTransaction: row.last_destination_transaction,
                  path: row.last_path,
                  expiresAt: row.last_expires_at ?? 0,
                }
              : null,
          lastSuccess:
            row.last_success_id && row.last_success_lasna_transaction
              ? {
                  id: row.last_success_id,
                  lasnaTransaction: row.last_success_lasna_transaction,
                  destinationTransaction: row.last_success_destination_transaction,
                  path: row.last_success_path,
                }
              : null,
          pending:
            row.pending_run_id && row.pending_expires_at !== null
              ? { id: row.pending_run_id, expiresAt: row.pending_expires_at }
              : null,
        };
      }),
    });
  });

  app.get('/v3/activity', routeRateLimit, async (request, reply) => {
    const input = query.safeParse(request.query);
    if (!input.success) return reply.code(400).send({ message: 'Check the activity filters.' });
    const { deployment, chains } = resolveDeployment(input.data.network);
    if (!deployment) return { runs: [], nextCursor: null, previousCursor: null };
    const owner = input.data.owner.toLowerCase();
    const { status, chain } = input.data;
    if (chain !== undefined && !chains.includes(chain)) {
      return reply.code(400).send({ message: 'Check the activity network.' });
    }
    const scope = pageScope(
      'activity',
      deployment,
      owner,
      input.data.id,
      input.data.workflow,
      chain,
      status,
    );
    let after;
    try {
      after = input.data.after ? readPageCursor(input.data.after, cursor, scope, true) : undefined;
    } catch {
      return reply.code(400).send({ message: 'This activity page link is invalid.' });
    }
    const ascending = Boolean(after?.before);
    let pageQuery = db
      .from('workflow_v2_activity')
      .select('*')
      .match({ deployment, owner })
      .in('chain', chain === undefined ? [...chains] : [chain]);
    if (input.data.id) pageQuery = pageQuery.eq('id', input.data.id);
    if (input.data.workflow) pageQuery = pageQuery.eq('workflow_id', input.data.workflow);
    if (status !== 'all') pageQuery = pageQuery.in('status', workflowActivityStatuses[status]);
    if (after) {
      const equalBlock = `lasna_block.eq.${after.block}`;
      const comparison = ascending ? 'gt' : 'lt';
      pageQuery = pageQuery.or(
        `lasna_block.${comparison}.${after.block},and(${equalBlock},id.${comparison}.${after.id}),and(${equalBlock},id.eq.${after.id},chain.${comparison}.${after.chain})`,
      );
    }
    const { data, error } = await pageQuery
      .order('lasna_block', { ascending })
      .order('id', { ascending })
      .order('chain', { ascending })
      .limit(workflowPageSize + 1);
    if (error) throw error;
    const page = bidirectionalPage(z.array(run).parse(data), after, (row, before) =>
      encodePageCursor(scope, { block: row.lasna_block, id: row.id, chain: row.chain, before }),
    );
    return {
      runs: page.items.map((row) => ({
        ...runProof(row),
        agent: row.agent,
        workflowId: row.workflow_id,
        title: row.title,
        epoch: row.epoch,
        reasonCode: row.reason,
      })),
      nextCursor: page.nextCursor,
      previousCursor: page.previousCursor,
    };
  });

  app.get('/v3/runs/:id', routeRateLimit, async (request, reply) => {
    const params = z.object({ id: workflowIdSchema }).safeParse(request.params);
    const networkQuery = z
      .object({ network: networkModeSchema.optional() })
      .safeParse(request.query);
    if (!params.success || !networkQuery.success)
      return reply.code(400).send({ message: 'This run ID is invalid.' });
    const modesToCheck: readonly NetworkMode[] = networkQuery.data.network
      ? [networkQuery.data.network]
      : ['testnet', 'mainnet'];
    let found: z.infer<typeof proofRow> | null = null;
    let foundMode: NetworkMode | undefined;
    for (const candidateMode of modesToCheck) {
      const { deployment, chains } = resolveDeployment(candidateMode);
      if (!deployment) continue;
      const { data, error } = await db
        .from('workflow_v2_activity')
        .select(proofColumns)
        .eq('deployment', deployment)
        .in('chain', [...chains])
        .eq('id', params.data.id)
        .order('lasna_block', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        found = proofRow.parse(data);
        foundMode = candidateMode;
        break;
      }
    }
    if (!found) return reply.code(404).send({ message: 'This run has not been indexed.' });
    const proof = runProof(found);
    if (
      foundMode &&
      proof.destinationTransaction === null &&
      (proof.status === 'pending' || proof.status === 'expired')
    ) {
      const reader = callbackReaders?.[foundMode];
      if (reader) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const callbacks = await Promise.race([
            reader.readCallbacks(found.lasna_transaction),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Callback lookup timed out')), 4_000);
            }),
          ]);
          const matched = callbacks.find(
            (record) =>
              record.destination_chain_id === found.chain &&
              (!found.agent ||
                record.reacting_contract.toLowerCase() === found.agent.toLowerCase()),
          );
          if (matched) {
            const hasTx = matched.destination_tx_hash !== zeroHash;
            const hasError = Boolean(matched.error_data && matched.error_data !== '0x');
            if (hasTx || hasError) {
              const enriched = workflowV2RunProofSchema.parse({
                ...proof,
                destinationTransaction: hasTx ? matched.destination_tx_hash : null,
                status: hasError ? 'failed' : proof.status,
                reason: hasError
                  ? workflowV2FailureReason(matched.error_data.slice(0, 10)).message
                  : proof.reason,
              });
              reply.header(
                'cache-control',
                enriched.status === 'confirmed' ? 'public, max-age=60' : 'no-cache',
              );
              return enriched;
            }
          }
        } catch {
          // Non-fatal fallback: return the indexed run state if Reactive RPC is unavailable.
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
    }
    reply.header('cache-control', proof.status === 'confirmed' ? 'public, max-age=60' : 'no-cache');
    return proof;
  });
}
