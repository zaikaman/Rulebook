import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  getChain,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowDeploymentKey,
  type Address,
  type FundsChainId,
  type WorkflowV2Deployment,
  type WorkflowV2MainnetDeployment,
} from '@rulebook/shared';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  baseMainnetChain,
  baseSepoliaChain,
  createChainClients,
  lasnaChain,
  ping,
  reactiveMainnetChain,
  unichainMainnetChain,
  unichainSepoliaChain,
  type ChainClients,
} from './chain/clients.js';
import { createLasnaCallbackReader } from './chain/lasnaCallbacks.js';
import { loadConfig } from './config.js';
import { createServiceClient, probeDatabase } from './db/client.js';
import type { IndexerHealthSnapshot, ServerDeps } from './deps.js';
import { registerRoutes } from './api/routes/index.js';
import { TelegramDatabase, TelegramService, telegramOwnership } from './telegram/service.js';
import { TelegramPoller } from './telegram/poller.js';
import { TelegramWorker } from './telegram/worker.js';
import { TelegramFundingAlerts } from './telegram/fundingAlerts.js';
import { WorkflowTelegramAlerts } from './telegram/workflowAlerts.js';
import { WorkflowV2Indexer } from './workflows/indexerV2.js';
import { registerWorkflowV2Routes } from './workflows/routesV2.js';
import { RulewrightService } from './rulewright/service.js';
import { AssistantService } from './assistant/service.js';

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
    routerOptions: {
      ignoreTrailingSlash: true,
    },
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
        message: status >= 500 ? 'Internal server error' : errorMessage(error),
        detail: null,
      },
    });
  });

  registerRoutes(app, deps);
  return { app, routePaths };
}

/** Pings only the RPCs required by the configured deployment modes so unconfigured testnets never degrade `/health`. */
export async function buildRpcHealthChecks(
  clients: ChainClients,
  v2?: WorkflowV2Deployment,
  v2Mainnet?: WorkflowV2MainnetDeployment,
): Promise<Array<{ chain_id: number; rpc_ok: boolean }>> {
  const targets: Array<{ chain_id: number; client: ChainClients['lasna'] }> = [];
  if (v2 || !v2Mainnet) {
    targets.push(
      { chain_id: lasnaChain.id, client: clients.lasna },
      { chain_id: unichainSepoliaChain.id, client: clients.unichain },
    );
    if (v2?.base && clients.base) {
      targets.push({ chain_id: baseSepoliaChain.id, client: clients.base });
    }
  }
  if (v2Mainnet && clients.reactiveMainnet && clients.unichainMainnet) {
    targets.push(
      { chain_id: reactiveMainnetChain.id, client: clients.reactiveMainnet },
      { chain_id: unichainMainnetChain.id, client: clients.unichainMainnet },
    );
    if (v2Mainnet.base && clients.baseMainnet) {
      targets.push({ chain_id: baseMainnetChain.id, client: clients.baseMainnet });
    }
  }
  return Promise.all(
    targets.map(async ({ chain_id, client }) => ({ chain_id, rpc_ok: await ping(client) })),
  );
}

/** Reads persisted indexer cursors and computes maximum cursor age in seconds. */
export async function buildIndexerHealth(
  supabase: ReturnType<typeof createServiceClient>,
  v2?: WorkflowV2Deployment,
  v2Mainnet?: WorkflowV2MainnetDeployment,
): Promise<IndexerHealthSnapshot> {
  const scopes: Array<{ deployment: string; chain: number }> = [];
  if (v2) {
    const dep = workflowDeploymentKey(LASNA_CHAIN_ID, v2.lasna.factory);
    scopes.push(
      { deployment: dep, chain: LASNA_CHAIN_ID },
      { deployment: dep, chain: UNICHAIN_SEPOLIA_CHAIN_ID },
    );
    if (v2.base) scopes.push({ deployment: dep, chain: BASE_SEPOLIA_CHAIN_ID });
  }
  if (v2Mainnet) {
    const dep = workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, v2Mainnet.reactive.factory);
    scopes.push(
      { deployment: dep, chain: REACTIVE_MAINNET_CHAIN_ID },
      { deployment: dep, chain: UNICHAIN_MAINNET_CHAIN_ID },
    );
    if (v2Mainnet.base) scopes.push({ deployment: dep, chain: BASE_MAINNET_CHAIN_ID });
  }
  if (scopes.length === 0) return { lag_seconds: 0, cursors: [], expected_chains: 0 };
  const deployments = [...new Set(scopes.map((s) => s.deployment))];
  const { data, error } = await supabase
    .from('workflow_v2_cursors')
    .select('deployment,chain,block_number,updated_at,block_time')
    .in('deployment', deployments)
    .abortSignal(AbortSignal.timeout(5_000));
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    deployment: string;
    chain: number;
    block_number: number;
    updated_at?: string | null;
    block_time?: string | null;
  }>;
  const now = Date.now();
  let maxLag = 0;
  const cursors: Array<{ chain_id: number; last_block: number; updated_at: string }> = [];
  for (const scope of scopes) {
    const row = rows.find((r) => r.deployment === scope.deployment && r.chain === scope.chain);
    if (!row) continue;
    const stamp = row.updated_at ?? row.block_time ?? new Date(0).toISOString();
    const ageMs = Math.max(0, now - Date.parse(stamp));
    const ageSeconds = Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : 0;
    if (ageSeconds > maxLag) maxLag = ageSeconds;
    cursors.push({
      chain_id: row.chain,
      last_block: Number(row.block_number),
      updated_at: stamp,
    });
  }
  return {
    lag_seconds: maxLag,
    cursors,
    expected_chains: scopes.length,
  };
}

/** Boots the service: database, RPC clients, HTTP listener, and the optional indexer loop. */
export async function startServer(): Promise<void> {
  const config = loadConfig();
  const supabase = createServiceClient(config);
  const clients = createChainClients(config);
  const v2 = config.workflowsV2;
  const v2Mainnet = config.workflowsV2Mainnet;
  const testnetVaultFactories: Partial<Record<FundsChainId, Address>> | undefined = v2
    ? {
        [UNICHAIN_SEPOLIA_CHAIN_ID]: v2.unichain.factory,
        ...(v2.base ? { [BASE_SEPOLIA_CHAIN_ID]: v2.base.factory } : {}),
      }
    : undefined;
  const mainnetVaultFactories: Partial<Record<FundsChainId, Address>> | undefined = v2Mainnet
    ? {
        [UNICHAIN_MAINNET_CHAIN_ID]: v2Mainnet.unichain.factory,
        ...(v2Mainnet.base ? { [BASE_MAINNET_CHAIN_ID]: v2Mainnet.base.factory } : {}),
      }
    : undefined;
  const vaultFactories: Partial<Record<FundsChainId, Address>> | undefined =
    testnetVaultFactories || mainnetVaultFactories
      ? { ...testnetVaultFactories, ...mainnetVaultFactories }
      : undefined;
  const testnetFundsChains: readonly FundsChainId[] = v2?.base
    ? [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]
    : [UNICHAIN_SEPOLIA_CHAIN_ID];
  const mainnetFundsChains: readonly FundsChainId[] = v2Mainnet?.base
    ? [UNICHAIN_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID]
    : [UNICHAIN_MAINNET_CHAIN_ID];
  const rulewright =
    config.gemini && vaultFactories
      ? new RulewrightService(supabase, clients, vaultFactories, config.gemini, config.demoAccount)
      : undefined;
  const assistant =
    config.gemini && (v2 || v2Mainnet)
      ? new AssistantService(
          supabase,
          clients,
          { testnet: v2, mainnet: v2Mainnet },
          config.gemini,
          config.demoAccount,
        )
      : undefined;
  const rulewrightShutdown = new AbortController();
  const telegramDb = config.telegram ? new TelegramDatabase(supabase) : undefined;
  const workflowAlerts =
    config.telegram && telegramDb
      ? [
          ...(v2
            ? [
                new WorkflowTelegramAlerts(
                  telegramDb,
                  clients,
                  v2.lasna.factory,
                  config.telegram.appOrigin,
                  testnetFundsChains,
                ),
              ]
            : []),
          ...(v2Mainnet
            ? [
                new WorkflowTelegramAlerts(
                  telegramDb,
                  clients,
                  v2Mainnet.reactive.factory,
                  config.telegram.appOrigin,
                  mainnetFundsChains,
                ),
              ]
            : []),
        ]
      : [];
  const fundingAlerts =
    config.telegram && telegramDb
      ? [
          ...(v2 && testnetVaultFactories
            ? [
                new TelegramFundingAlerts(
                  telegramDb,
                  clients,
                  v2.lasna.factory,
                  testnetVaultFactories,
                  config.telegram.appOrigin,
                  LASNA_CHAIN_ID,
                ),
              ]
            : []),
          ...(v2Mainnet && mainnetVaultFactories
            ? [
                new TelegramFundingAlerts(
                  telegramDb,
                  clients,
                  v2Mainnet.reactive.factory,
                  mainnetVaultFactories,
                  config.telegram.appOrigin,
                  REACTIVE_MAINNET_CHAIN_ID,
                ),
              ]
            : []),
        ]
      : [];
  const telegram =
    config.telegram && telegramDb
      ? new TelegramService(
          config.telegram,
          telegramDb,
          telegramOwnership(clients, config.telegram.factoryTargets),
          workflowAlerts.length > 0 ? workflowAlerts : undefined,
        )
      : undefined;
  const { app } = buildServer({
    config,
    telegram,
    rulewright,
    assistant,
    databaseReachable: () => probeDatabase(supabase),
    rpcHealth: () => buildRpcHealthChecks(clients, v2, v2Mainnet),
    indexerHealth: () => buildIndexerHealth(supabase, v2, v2Mainnet),
  });

  if (v2 || v2Mainnet) {
    const callbackReaders = {
      ...(v2
        ? {
            testnet: createLasnaCallbackReader(
              clients.lasna,
              getChain(LASNA_CHAIN_ID).systemContract,
            ),
          }
        : {}),
      ...(v2Mainnet && clients.reactiveMainnet
        ? {
            mainnet: createLasnaCallbackReader(
              clients.reactiveMainnet,
              getChain(REACTIVE_MAINNET_CHAIN_ID).systemContract,
            ),
          }
        : {}),
    };
    void app.register(async (v2Scope) => {
      await v2Scope.register(rateLimit, { global: false });
      registerWorkflowV2Routes(
        v2Scope,
        supabase,
        {
          testnet: v2?.lasna.factory,
          mainnet: v2Mainnet?.reactive.factory,
        },
        callbackReaders,
        {
          owner: config.demoAccount,
          featuredRunIds: config.demoFeaturedRunIds,
        },
        { clients, corsOrigins: config.corsOrigins, vaultFactories: vaultFactories ?? {} },
      );
    });
  }
  const workflowV2Indexer =
    v2 && config.INDEXER_ENABLED
      ? new WorkflowV2Indexer(supabase, clients, v2, app.log, telegram !== undefined)
      : undefined;
  const workflowV2MainnetIndexer =
    v2Mainnet && config.INDEXER_ENABLED
      ? new WorkflowV2Indexer(supabase, clients, v2Mainnet, app.log, telegram !== undefined)
      : undefined;
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  const rulewrightRun = rulewright?.run(app.log, rulewrightShutdown.signal);
  const assistantRun = assistant?.run(app.log, rulewrightShutdown.signal);
  const workflowV2IndexerRun = workflowV2Indexer?.run();
  const workflowV2MainnetIndexerRun = workflowV2MainnetIndexer?.run();

  const worker =
    telegram && telegramDb
      ? new TelegramWorker(telegramDb, telegram, app.log, workflowAlerts, fundingAlerts)
      : undefined;
  const workerRun = worker?.run();
  const telegramPoller =
    telegram?.config.updates === 'polling' ? new TelegramPoller(telegram, app.log) : undefined;
  const telegramPolling = telegramPoller?.run();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      rulewrightShutdown.abort();
      workflowV2Indexer?.stop();
      workflowV2MainnetIndexer?.stop();
      worker?.stop();
      telegramPoller?.stop();
      const timeout = setTimeout(() => process.exit(1), 15_000);
      timeout.unref();
      void Promise.allSettled([
        app.close(),
        workflowV2IndexerRun,
        workflowV2MainnetIndexerRun,
        workerRun,
        telegramPolling,
        rulewrightRun,
        assistantRun,
      ]).then(() => {
        clearTimeout(timeout);
        process.exit(0);
      });
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
