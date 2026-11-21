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
import { TelegramDatabase, TelegramService, telegramOwnership } from './telegram/service.js';
import { TelegramPoller } from './telegram/poller.js';
import { TelegramWorker } from './telegram/worker.js';
import { TelegramFundingAlerts } from './telegram/fundingAlerts.js';
import { WorkflowTelegramAlerts } from './telegram/workflowAlerts.js';
import { WorkflowIndexer } from './workflows/indexer.js';
import { WorkflowV2Indexer } from './workflows/indexerV2.js';
import { registerWorkflowRoutes } from './workflows/routes.js';
import { registerWorkflowV2Routes } from './workflows/routesV2.js';
import { RulewrightService } from './rulewright/service.js';

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
    // The Heroku router adds the client address as the last forwarded hop.
    trustProxy: process.env.DYNO ? (_address, hop) => hop === 0 : false,
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
  const v2 = config.workflowsV2;
  const rulewright =
    config.gemini && v2
      ? new RulewrightService(supabase, clients, v2.unichain.factory, config.gemini)
      : undefined;
  const rulewrightShutdown = new AbortController();
  const telegramDb = config.telegram ? new TelegramDatabase(supabase) : undefined;
  const workflowAlerts =
    config.telegram && telegramDb && v2
      ? new WorkflowTelegramAlerts(
          telegramDb,
          clients.unichain,
          v2.lasna.factory,
          config.telegram.appOrigin,
        )
      : undefined;
  const fundingAlerts =
    config.telegram && telegramDb && v2
      ? new TelegramFundingAlerts(
          telegramDb,
          clients,
          v2.lasna.factory,
          v2.unichain.factory,
          config.telegram.appOrigin,
        )
      : undefined;
  const telegram =
    config.telegram && telegramDb
      ? new TelegramService(
          config.telegram,
          telegramDb,
          telegramOwnership(clients, config.telegram.factories),
          repositories,
          workflowAlerts,
        )
      : undefined;
  const { app } = buildServer({
    config,
    repositories,
    cursors,
    telegram,
    rulewright,
    accountChain: new PublicAccountChain(clients),
    proofSource: createProofSource(clients),
    sponsorSource: new PublicSponsorSource(clients),
    databaseReachable: () => probeDatabase(supabase),
    rpcHealth: async () => [
      { chain_id: lasnaChain.id, rpc_ok: await ping(clients.lasna) },
      { chain_id: unichainSepoliaChain.id, rpc_ok: await ping(clients.unichain) },
    ],
  });

  registerWorkflowRoutes(app, supabase);
  const workflowIndexer =
    config.workflows && config.INDEXER_ENABLED
      ? new WorkflowIndexer(supabase, clients, config.workflows, app.log)
      : undefined;
  if (v2) registerWorkflowV2Routes(app, supabase, v2.lasna.factory, config.workflowV2Archived);
  const workflowV2Indexer =
    v2 && config.INDEXER_ENABLED
      ? new WorkflowV2Indexer(supabase, clients, v2, app.log, telegram !== undefined)
      : undefined;
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  const rulewrightRun = rulewright?.run(app.log, rulewrightShutdown.signal);
  void workflowIndexer?.run();
  void workflowV2Indexer?.run();

  const worker =
    telegram && telegramDb
      ? new TelegramWorker(telegramDb, telegram, app.log, workflowAlerts, fundingAlerts)
      : undefined;
  const workerRun = worker?.run();
  const telegramPoller =
    telegram?.config.updates === 'polling' ? new TelegramPoller(telegram, app.log) : undefined;
  const telegramPolling = telegramPoller?.run();
  let poller: IndexerPoller | undefined;
  if (config.INDEXER_ENABLED && !config.workflows) {
    const startBlocks = {
      [lasnaChain.id]: config.INDEXER_START_BLOCK_LASNA,
      [unichainSepoliaChain.id]: config.INDEXER_START_BLOCK_UNICHAIN,
    };
    poller = new IndexerPoller({
      repositories,
      store,
      cursors,
      clients,
      startBlocks,
      confirmationDepth: { [lasnaChain.id]: 20, [unichainSepoliaChain.id]: 12 },
      // Unichain Sepolia rejects eth_getLogs ranges wider than 1000 blocks.
      rangeSize: 1_000,
      stageTelegramNotifications: telegram !== undefined,
    });
    void poller.run(Object.keys(startBlocks).map(Number));
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      rulewrightShutdown.abort();
      poller?.stop();
      workflowIndexer?.stop();
      workflowV2Indexer?.stop();
      worker?.stop();
      telegramPoller?.stop();
      void Promise.all([app.close(), workerRun, telegramPolling, rulewrightRun]).then(() =>
        process.exit(0),
      );
    });
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
