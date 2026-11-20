import {
  workflowActivitySchema,
  workflowIdSchema,
  workflowListingSchema,
  workflowRunSchema,
  workflowTriggers,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const browseSchema = z.object({
  q: z.string().max(160).default(''),
  tag: z.string().max(30).default(''),
  trigger: z.enum(['', ...workflowTriggers]).default(''),
  sort: z.enum(['popular', 'newest', 'runs']).default('popular'),
  cursor: z.string().max(300).optional(),
});

const pageCursor = z.object({
  score: z.number().int().nonnegative().safe(),
  id: z.string().regex(/^[1-9]\d{0,77}$/),
});
const activityCursor = z.object({
  block: z.number().int().nonnegative().safe(),
  id: workflowIdSchema,
});
const walletAddress = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/i)
  .toLowerCase();

function input<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) return result.data;
  throw Object.assign(new Error('Check the request parameters.'), { statusCode: 400 });
}

function cursorFrom<T>(schema: z.ZodType<T>, value: string | undefined) {
  if (!value) return null;
  try {
    return schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw Object.assign(new Error('This page link is invalid.'), { statusCode: 400 });
  }
}

function result<T>(response: { data: T; error: unknown }) {
  if (response.error) throw response.error;
  return response.data;
}

function listing(row: Record<string, unknown>, id: string) {
  return workflowListingSchema.parse({
    ...row,
    id,
    workflowId: row.workflow_id,
    programHash: row.program_hash,
  });
}

interface Decision {
  id: string;
  agent: string;
  workflow_id: string;
  program: string;
  program_hash: string;
  leaf: number;
  observed: string;
  origin_chain: number;
  origin_transaction: string;
  origin_log_index: string;
  lasna_transaction: string;
  lasna_block: number;
  expires_at: number;
  skipped: boolean;
}

interface Outcome {
  id: string;
  destination_transaction: string;
  completed: boolean;
  reason: string;
  vault: string;
}

function run(row: Decision, outcome?: Outcome, steps: object[] = []) {
  return workflowRunSchema.parse({
    id: row.id,
    workflowId: row.workflow_id,
    program: row.program,
    programHash: row.program_hash,
    leaf: row.leaf,
    observed: row.observed,
    originChain: row.origin_chain,
    originTransaction: row.origin_transaction,
    originLogIndex: row.origin_log_index,
    lasnaTransaction: row.lasna_transaction,
    destinationTransaction: outcome?.destination_transaction ?? null,
    expiresAt: row.expires_at,
    reason: outcome?.reason ?? null,
    steps,
    status: row.skipped
      ? 'Skipped'
      : outcome
        ? outcome.completed
          ? 'Completed'
          : 'Failed'
        : Date.now() >= row.expires_at * 1_000
          ? 'No result confirmed'
          : 'Waiting for confirmation',
  });
}

export function registerWorkflowRoutes(app: FastifyInstance, db: SupabaseClient) {
  app.get('/v2/marketplace', async (req) => {
    const { q, tag, trigger, sort, cursor: token } = input(browseSchema.safeParse(req.query));
    const cursor = cursorFrom(pageCursor, token);
    const limit = 24;
    const rows = result(
      await db.rpc('browse_workflow_marketplace', {
        search_text: q.trim(),
        filter_tag: tag,
        filter_trigger: trigger,
        sort_mode: sort,
        after_score: cursor?.score ?? null,
        after_id: cursor?.id ?? null,
        page_size: limit + 1,
      }),
    ) as { item: Record<string, unknown>; score: number; listing_id: string }[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      listings: page.map((row) => listing(row.item, row.listing_id)),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify({ score: last.score, id: last.listing_id })).toString(
              'base64url',
            )
          : null,
    };
  });

  app.get('/v2/marketplace/:id', async (req, reply) => {
    const { id } = input(
      z.object({ id: z.string().regex(/^[1-9]\d{0,77}$/) }).safeParse(req.params),
    );
    const row = result(
      await db.from('workflow_marketplace').select('*').eq('id', id).maybeSingle(),
    );
    if (!row) return reply.code(404).send({ message: 'This workflow is no longer listed.' });
    return listing(row, id);
  });

  app.get('/v2/activity', async (req) => {
    const {
      owner,
      filter,
      cursor: token,
    } = input(
      z
        .object({
          owner: walletAddress,
          filter: z.enum(['all', 'attention']).default('all'),
          cursor: z.string().max(160).optional(),
        })
        .safeParse(req.query),
    );
    const cursor = cursorFrom(activityCursor, token);
    const limit = 30;
    const rows = result(
      await db.rpc('list_workflow_activity', {
        wallet_owner: owner,
        attention_only: filter === 'attention',
        after_block: cursor?.block ?? null,
        after_run: cursor?.id ?? null,
        page_size: limit + 1,
      }),
    ) as {
      id: string;
      workflow_id: string;
      title: string | null;
      lasna_block: number;
      status: string;
    }[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return workflowActivitySchema.parse({
      runs: page.map((row) => ({
        id: row.id,
        workflowId: row.workflow_id,
        title: row.title,
        status: row.status,
      })),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify({ block: last.lasna_block, id: last.id })).toString(
              'base64url',
            )
          : null,
    });
  });

  app.get('/v2/workflows/:agent/:id/runs', async (req) => {
    const { agent, id } = input(
      z
        .object({
          agent: walletAddress,
          id: workflowIdSchema,
        })
        .safeParse(req.params),
    );
    const rows = result(
      await db
        .from('workflow_decisions')
        .select('*')
        .eq('agent', agent)
        .eq('workflow_id', id)
        .order('lasna_block', { ascending: false })
        .order('id')
        .limit(50),
    ) as Decision[];
    if (rows.length === 0) return { runs: [] };
    const outcomes = result(
      await db
        .from('workflow_verified_outcomes')
        .select('*')
        .in(
          'id',
          rows.map((row) => row.id),
        ),
    ) as Outcome[];
    const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
    return { runs: rows.map((row) => run(row, byId.get(row.id))) };
  });

  app.get('/v2/runs/:id', async (req, reply) => {
    const { id } = input(z.object({ id: workflowIdSchema }).safeParse(req.params));
    const row = result(
      await db.from('workflow_decisions').select('*').eq('id', id).maybeSingle(),
    ) as Decision | null;
    if (!row) return reply.code(404).send({ message: 'This run is not indexed yet.' });
    const outcome = result(
      await db.from('workflow_verified_outcomes').select('*').eq('id', id).maybeSingle(),
    ) as Outcome | null;
    const steps = outcome?.completed
      ? result(
          await db
            .from('workflow_steps')
            .select('*')
            .eq('id', id)
            .eq('vault', outcome.vault)
            .eq('destination_transaction', outcome.destination_transaction)
            .order('step'),
        )
      : [];
    return run(
      row,
      outcome ?? undefined,
      (steps ?? []).map((step) => ({ ...step, index: step.step })),
    );
  });
}
