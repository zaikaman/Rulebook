import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';

/** Registers `GET /health` for the platform health check. */
export function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/health', async () => {
    const [databaseReachable, chains] = await Promise.all([
      deps.databaseReachable(),
      deps.rpcHealth(),
    ]);
    const rpcDegraded = chains.some((chain) => !chain.rpc_ok);
    return {
      status: !databaseReachable
        ? 'down'
        : !deps.config.INDEXER_ENABLED || rpcDegraded
          ? 'degraded'
          : 'ok',
      indexer: { enabled: deps.config.INDEXER_ENABLED },
      database: {
        reachable: databaseReachable,
        paused_hint: databaseReachable ? null : 'Supabase is unreachable, paused, or restoring.',
      },
      chains,
    };
  });
}
