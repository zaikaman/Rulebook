import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { createChainClients, lasnaChain, ping, unichainSepoliaChain } from './chain/clients.js';
import { createProofSource } from './chain/proofSource.js';
import { PublicSponsorSource } from './chain/sponsorSource.js';
import { loadConfig } from './config.js';
import { createServiceClient, probeDatabase } from './db/client.js';
import { createRepositories } from './db/repositories/index.js';
import { SupabaseStore } from './db/store.js';
import type { ServerDeps } from './deps.js';
import { CursorStore } from './indexer/cursors.js';
import { IndexerPoller } from './indexer/poller.js';
import { registerRoutes } from './api/routes/index.js';
import { PublicAccountChain } from './sponsor/accountChain.js';

export interface BuiltServer {
  readonly app: FastifyInstance;
  /** Every registered `METHOD /path`, used by the API contract test. */
  readonly routePaths: string[];
}

/** Builds the Fastify app from injected dependencies; never binds a port. */
export function buildServer(
  deps: ServerDeps,
  options: { readonly logger?: boolean } = {},
): BuiltServer {
  const app = Fastify({
    logger: options.logger ?? true,
    genReqId: () => randomUUID(),
  });
  const routePaths: string[] = [];

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      routePaths.push(`${method} ${route.url}`);
    }
  });

  void app.register(cors, { origin: [...deps.config.corsOrigins] });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: 'not_found',
        message: `No route for ${request.method} ${request.url}`,
        detail: null,
      },
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    const status = errorStatus(error);
    reply.status(status).send({
      error: {
        code: status >= 500 ? 'internal_error' : 'invalid_query',
        message: errorMessage(error),
        detail: null,
      },
    });
  });

  registerRoutes(app, deps);
  return { app, routePaths };
}

/** Boots the service: database, RPC clients, HTTP listener, and the optional indexer loop. */
export async function startServer(): Promise<void> {
  const config = loadConfig();
  const supabase = createServiceClient(config);
  const store = new SupabaseStore(supabase);
  const repositories = createRepositories(store);
  const cursors = new CursorStore(store);
  const clients = createChainClients(config);
  const { app } = buildServer({
    config,
    repositories,
    cursors,
    accountChain: new PublicAccountChain(clients),
    proofSource: createProofSource(clients),
    sponsorSource: new PublicSponsorSource(clients),
    databaseReachable: () => probeDatabase(supabase),
    rpcHealth: async () => [
      { chain_id: lasnaChain.id, rpc_ok: await ping(clients.lasna) },
      { chain_id: unichainSepoliaChain.id, rpc_ok: await ping(clients.unichain) },
    ],
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });

  if (config.INDEXER_ENABLED) {
    const startBlocks = {
      [lasnaChain.id]: config.INDEXER_START_BLOCK_LASNA,
      [unichainSepoliaChain.id]: config.INDEXER_START_BLOCK_UNICHAIN,
    };
    const poller = new IndexerPoller({
      repositories,
      store,
      cursors,
      clients,
      startBlocks,
      confirmationDepth: { [lasnaChain.id]: 20, [unichainSepoliaChain.id]: 12 },
      // Unichain Sepolia rejects eth_getLogs ranges wider than 1000 blocks.
      rangeSize: 1_000,
    });
    void poller.run(Object.keys(startBlocks).map(Number));
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        poller.stop();
        void app.close().then(() => process.exit(0));
      });
    }
  }
}

function errorStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const value: unknown = (error as { statusCode?: unknown }).statusCode;
    if (typeof value === 'number') return value;
  }
  return 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === entry) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
