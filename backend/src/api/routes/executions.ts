import type { StoreValue } from '../../db/store.js';
import type { ServerDeps } from '../../deps.js';
import type { FastifyInstance } from 'fastify';

/** Registers `GET /v1/executions`. */
export function registerExecutionRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{
    Querystring: {
      agent?: string;
      ruleId?: string;
      kind?: 'executed' | 'mirrored';
      cursor?: string;
      limit?: string;
    };
  }>('/v1/executions', async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit ?? 25), 1), 100);
    const offset = decodeCursor(request.query.cursor);
    const filters: Record<string, StoreValue> = {};
    if (request.query.agent) filters.agent = request.query.agent.toLowerCase();
    if (request.query.ruleId) filters.rule_id = request.query.ruleId;
    if (request.query.kind) filters.kind = request.query.kind;

    const rows = await deps.repositories.executions.list(filters, limit + offset + 1);
    const page = rows.slice(offset, offset + limit);
    const hasMore = rows.length > offset + limit;

    const executions = await Promise.all(
      page.map(async (row) => {
        const callback = await deps.repositories.callbacks.findByDestinationTx(row.tx_hash);
        return {
          chain_id: row.chain_id,
          tx_hash: row.tx_hash,
          vault: row.vault,
          agent: row.agent,
          rule_id: row.rule_id,
          kind: row.kind,
          block_time: row.block_time,
          status: row.status,
          ...(row.token_in ? { token_in: row.token_in } : {}),
          ...(row.token_out ? { token_out: row.token_out } : {}),
          ...(row.amount_in ? { amount_in: row.amount_in } : {}),
          ...(row.amount_out ? { amount_out: row.amount_out } : {}),
          ...(row.leader_tx ? { leader_tx: row.leader_tx } : {}),
          ...(callback ? { reactive_tx_hash: callback.reactive_tx_hash } : {}),
        };
      }),
    );

    return {
      executions,
      next_cursor: hasMore ? encodeCursor(offset + limit) : null,
    };
  });
}

/** Cursors are opaque base64 offsets; clients must not parse them. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number(Buffer.from(cursor, 'base64').toString('utf8'));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
