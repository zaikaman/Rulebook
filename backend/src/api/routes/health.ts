import type { FastifyInstance } from 'fastify';

import type { IndexerHealthSnapshot, ServerDeps } from '../../deps.js';

const HEALTH_CACHE_TTL_MS = 5_000;
const STALE_INDEXER_SECONDS = 300;

interface HealthPayload {
  status: 'ok' | 'degraded' | 'down';
  indexer: {
    enabled: boolean;
    lag_seconds: number;
    cursors: Array<{ chain_id: number; last_block: number; updated_at: string }>;
  };
  database: {
    reachable: boolean;
    paused_hint: string | null;
  };
  chains: Array<{ chain_id: number; rpc_ok: boolean }>;
}

/** Registers `GET /health` for the platform health check. */
export function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  let cached: { value: HealthPayload; expiresAt: number } | undefined;
  let inFlight: Promise<HealthPayload> | undefined;

  async function computeHealth(): Promise<HealthPayload> {
    const fallbackIndexer: IndexerHealthSnapshot = { lag_seconds: 0, cursors: [] };
    const [databaseReachable, chains, indexer] = await Promise.all([
      deps.databaseReachable(),
      deps.rpcHealth(),
      deps.indexerHealth
        ? deps.indexerHealth().catch(() => ({
            lag_seconds: STALE_INDEXER_SECONDS + 1,
            cursors: [],
            expected_chains: 1,
          }))
        : Promise.resolve(fallbackIndexer),
    ]);
    const rpcDegraded = chains.some((chain) => !chain.rpc_ok);
    const missingCursors =
      deps.config.INDEXER_ENABLED &&
      (indexer.expected_chains ?? 0) > 0 &&
      indexer.cursors.length < (indexer.expected_chains ?? 0);
    const indexerStale =
      deps.config.INDEXER_ENABLED &&
      (indexer.lag_seconds > STALE_INDEXER_SECONDS || missingCursors);
    return {
      status: !databaseReachable
        ? 'down'
        : !deps.config.INDEXER_ENABLED || rpcDegraded || indexerStale
          ? 'degraded'
          : 'ok',
      indexer: {
        enabled: deps.config.INDEXER_ENABLED,
        lag_seconds: indexer.lag_seconds,
        cursors: indexer.cursors.map((cursor) => ({
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
    };
  }

  app.get('/health', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async () => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;
    if (!inFlight) {
      inFlight = computeHealth()
        .then((value) => {
          cached = { value, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS };
          return value;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  });
}
