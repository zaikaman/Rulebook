import {
  addressSchema,
  automationChainFor,
  fundsChainIdSchema,
  fundsChainsFor,
  networkModeSchema,
  workflowDeploymentKey,
  workflowHealthResponseSchema,
  workflowIdSchema,
  workflowV2RunProofSchema,
  workflowV2RunStatusSchema,
  type Address,
  type NetworkMode,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { zeroHash } from 'viem';
import { z } from 'zod';

import type { CallbackReader } from '../chain/lasnaCallbacks.js';
import { workflowV2FailureReason } from './failureReasons.js';
const settlementChain = fundsChainIdSchema;
const cursor = z.object({
  block: z.number().int().nonnegative().safe(),
  id: workflowIdSchema,
  chain: settlementChain,
});

const query = z.object({
  owner: addressSchema,
  id: workflowIdSchema.optional(),
  workflow: workflowIdSchema.optional(),
  after: z.string().max(250).optional(),
  network: networkModeSchema.default('testnet'),
});
const listingId = z.string().regex(/^[1-9]\d{0,77}$/);
const listing = z.object({
  id: listingId,
  owner: addressSchema,
  agent: addressSchema,
  workflow_id: workflowIdSchema,
  program_hash: workflowIdSchema,
  program: z.string().regex(/^0x[\da-f]+$/i),
  chain: settlementChain,
  title: z.string(),
  description: z.string(),
  block_number: z.number().int().safe(),
  log_index: z.number().int().nonnegative(),
});
const marketCursor = z.object({
  block: z.number().int().nonnegative().safe(),
  index: z.number().int().nonnegative().safe(),
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
const routeRateLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } } as const;

function readCursor(value: string | undefined) {
  if (!value) return undefined;
  try {
    return cursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw Object.assign(new Error('This activity page link is invalid.'), { statusCode: 400 });
  }
}

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
      deployment: address ? workflowDeploymentKey(automationChainFor(network), address) : null,
      chains: fundsChainsFor(network),
    };
  }

  app.get('/v3/marketplace', routeRateLimit, async (request, reply) => {
    const params = z
      .object({
        q: z.string().max(160).default(''),
        after: z.string().max(250).optional(),
        network: networkModeSchema.default('testnet'),
      })
      .safeParse(request.query);
    if (!params.success) return reply.code(400).send({ message: 'Check the search parameters.' });
    const { deployment, chains } = resolveDeployment(params.data.network);
    if (!deployment) return { listings: [], nextCursor: null };
    let before;
    if (params.data.after) {
      try {
        before = marketCursor.parse(
          JSON.parse(Buffer.from(params.data.after, 'base64url').toString('utf8')),
        );
      } catch {
        return reply.code(400).send({ message: 'This Marketplace page link is invalid.' });
      }
    }
    let page = db
      .from('workflow_v2_market_listings')
      .select('*')
      .match({ deployment, visible: true })
      .in('chain', [...chains]);
    const search = params.data.q.trim().replace(/[%_\\*"]/g, (character) => `\\${character}`);
    if (search) page = page.or(`title.ilike."%${search}%",description.ilike."%${search}%"`);
    if (before)
      page = page.or(
        `block_number.lt.${before.block},and(block_number.eq.${before.block},log_index.lt.${before.index})`,
      );
    const limit = 24;
    const { data, error } = await page
      .order('block_number', { ascending: false })
      .order('log_index', { ascending: false })
      .limit(limit + 1);
    if (error) throw error;
    const rows = z.array(listing).parse(data);
    const last = rows[limit - 1];
    return {
      listings: rows.slice(0, limit),
      nextCursor:
        last && rows.length > limit
          ? Buffer.from(
              JSON.stringify({ block: last.block_number, index: last.log_index }),
            ).toString('base64url')
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
    const { data, error } = await db
      .from('workflow_v2_market_listings')
      .select('*')
      .match({ deployment, visible: true, id: params.data.id })
      .in('chain', [...chains])
      .maybeSingle();
    if (error) throw error;
    return data
      ? listing.parse(data)
      : reply.code(404).send({ message: 'This listing is unavailable.' });
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
    const { deployment } = resolveDeployment(input.data.network);
    if (!deployment) return { runs: [], nextCursor: null };
    const after = readCursor(input.data.after);
    const limit = 24;
    let pageQuery = db
      .from('workflow_v2_activity')
      .select('*')
      .match({ deployment, owner: input.data.owner.toLowerCase() })
      .in('chain', [...fundsChainsFor(input.data.network)]);
    if (input.data.id) pageQuery = pageQuery.eq('id', input.data.id);
    if (input.data.workflow) pageQuery = pageQuery.eq('workflow_id', input.data.workflow);
    if (after) {
      const equalBlock = `lasna_block.eq.${after.block}`;
      pageQuery = pageQuery.or(
        `lasna_block.lt.${after.block},and(${equalBlock},id.lt.${after.id}),and(${equalBlock},id.eq.${after.id},chain.lt.${after.chain})`,
      );
    }
    const { data, error } = await pageQuery
      .order('lasna_block', { ascending: false })
      .order('id', { ascending: false })
      .order('chain', { ascending: false })
      .limit(limit + 1);
    if (error) throw error;
    const rows = z.array(run).parse(data);
    const last = rows[limit - 1];
    return {
      runs: rows.slice(0, limit).map((row) => ({
        ...runProof(row),
        agent: row.agent,
        workflowId: row.workflow_id,
        title: row.title,
        epoch: row.epoch,
        reasonCode: row.reason,
      })),
      nextCursor:
        last && rows.length > limit
          ? Buffer.from(
              JSON.stringify({ block: last.lasna_block, id: last.id, chain: last.chain }),
            ).toString('base64url')
          : null,
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
