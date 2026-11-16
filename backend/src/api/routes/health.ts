import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';

/** Registers `GET /health`. */
export function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/health', async () => {
    const [cursors, databaseReachable, chains, deadLetters] = await Promise.all([
      deps.cursors.list(),
      deps.databaseReachable(),
      deps.rpcHealth(),
      deps.repositories.deadLetter.count(),
    ]);

    const lagSeconds = cursors.reduce((worst, cursor) => {
      const updated = Date.parse(cursor.updated_at);
      if (Number.isNaN(updated)) return worst;
      return Math.max(worst, Math.floor((Date.now() - updated) / 1000));
    }, 0);

    const rpcDegraded = chains.some((chain) => !chain.rpc_ok);
    const status = !databaseReachable
      ? 'down'
      : !deps.config.INDEXER_ENABLED || rpcDegraded
        ? 'degraded'
        : 'ok';

    return {
      status,
      indexer: {
        enabled: deps.config.INDEXER_ENABLED,
        lag_seconds: Math.max(0, lagSeconds),
        cursors: cursors.map((cursor) => ({
          chain_id: cursor.chain_id,
          last_block: cursor.last_block,
          updated_at: cursor.updated_at,
        })),
      },
      database: {
        reachable: databaseReachable,
        paused_hint: databaseReachable ? null : 'Supabase is unreachable, paused, or restoring.',
      },
      chains,
      dead_letter: { count: deadLetters },
    };
  });
}
