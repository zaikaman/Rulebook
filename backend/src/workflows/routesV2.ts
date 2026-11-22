import {
  addressSchema,
  workflowHealthResponseSchema,
  workflowIdSchema,
  workflowV2RunProofSchema,
  workflowV2RunStatusSchema,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { workflowV2FailureReason } from './failureReasons.js';
const settlementChain = z.literal(UNICHAIN_SEPOLIA_CHAIN_ID);
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
const proofRow = run.pick({
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
});
const proofColumns = Object.keys(proofRow.shape).join(',');

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
  factory: Address,
  archivedFactories: readonly Address[] = [],
) {
  const deployment = factory.toLowerCase();
  // Public run IDs keep resolving after a factory cutover; the indexer only writes the current
  // deployment, so archived rows are whatever the previous deployment indexed.
  const proofDeployments = [
    ...new Set([deployment, ...archivedFactories.map((address) => address.toLowerCase())]),
  ];
  app.get('/v3/marketplace', async (request, reply) => {
    const params = z
      .object({ q: z.string().max(160).default(''), after: z.string().max(250).optional() })
      .safeParse(request.query);
    if (!params.success) return reply.code(400).send({ message: 'Check the search parameters.' });
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
      .match({ deployment, visible: true });
    const search = params.data.q.trim().replace(/[%_\\*]/g, (character) => `\\${character}`);
    if (search) page = page.ilike('title', `%${search}%`);
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

  app.get('/v3/marketplace/:id', async (request, reply) => {
    const params = z.object({ id: listingId }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: 'This listing ID is invalid.' });
    const { data, error } = await db
      .from('workflow_v2_market_listings')
      .select('*')
      .match({ deployment, visible: true, id: params.data.id })
      .maybeSingle();
    if (error) throw error;
    return data
      ? listing.parse(data)
      : reply.code(404).send({ message: 'This listing is unavailable.' });
  });

  app.get('/v3/health', async (request, reply) => {
    const input = z.object({ owner: addressSchema }).safeParse(request.query);
    if (!input.success) return reply.code(400).send({ message: 'Check the wallet address.' });
    const { data, error } = await db.rpc('workflow_v2_health', {
      p_deployment: deployment,
      p_owner: input.data.owner,
    });
    if (error) throw error;
    const rows = z.array(healthRow).parse(data);
    return workflowHealthResponseSchema.parse({
      workflows: rows.map((row) => {
        const failure = row.last_reason ? workflowV2FailureReason(row.last_reason) : undefined;
        return {
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

  app.get('/v3/activity', async (request, reply) => {
    const input = query.safeParse(request.query);
    if (!input.success) return reply.code(400).send({ message: 'Check the activity filters.' });
    const after = readCursor(input.data.after);
    const limit = 24;
    let pageQuery = db
      .from('workflow_v2_activity')
      .select('*')
      .match({ deployment, owner: input.data.owner.toLowerCase() });
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

  app.get('/v3/runs/:id', async (request, reply) => {
    const params = z.object({ id: workflowIdSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: 'This run ID is invalid.' });
    const { data, error } = await db
      .from('workflow_v2_activity')
      .select(proofColumns)
      .in('deployment', proofDeployments)
      .match({ chain: UNICHAIN_SEPOLIA_CHAIN_ID, id: params.data.id })
      .order('lasna_block', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return reply.code(404).send({ message: 'This run has not been indexed.' });
    const proof = runProof(proofRow.parse(data));
    reply.header('cache-control', proof.status === 'confirmed' ? 'public, max-age=60' : 'no-cache');
    return proof;
  });
}
