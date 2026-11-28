import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  telegramSignIn,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowDeploymentKey,
  workflowVaultV2Abi,
  type TelegramChallenge,
  type WorkflowV2MainnetDeployment,
} from '@rulebook/shared';
import { createClient } from '@supabase/supabase-js';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { verifyTypedData, type Address, type Hex, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { verifyTelegramProxy } from '../../scripts/deploy-production.mjs';
import { registerTelegramRoutes } from '../src/api/routes/telegram.js';
import { clientFor, createChainClients } from '../src/chain/clients.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { buildRpcHealthChecks } from '../src/server.js';
import { TelegramFundingAlerts } from '../src/telegram/fundingAlerts.js';
import {
  TelegramService,
  telegramOwnership,
  type TelegramDatabase,
} from '../src/telegram/service.js';
import { TelegramWorker } from '../src/telegram/worker.js';
import { payoutPreflight, WorkflowTelegramAlerts } from '../src/telegram/workflowAlerts.js';
import { WorkflowV2Indexer } from '../src/workflows/indexerV2.js';
import { registerWorkflowV2Routes } from '../src/workflows/routesV2.js';

const silentLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as FastifyBaseLogger;

const REACTIVE_FACTORY = '0x1111111111111111111111111111111111111111' as Address;
const UNICHAIN_FACTORY = '0x2222222222222222222222222222222222222222' as Address;
const BASE_FACTORY = '0x3333333333333333333333333333333333333333' as Address;

const MAINNET_DEPLOYMENT: WorkflowV2MainnetDeployment = {
  reactive: { factory: REACTIVE_FACTORY, startBlock: 10 },
  unichain: { factory: UNICHAIN_FACTORY, startBlock: 20 },
  base: { factory: BASE_FACTORY, startBlock: 30 },
};

function mainnetDbFixture() {
  const upserts: Array<{ table: string; rows: unknown[] }> = [];
  const db = createClient('https://database.example', 'fixture-key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split('/').pop() ?? '';
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST') {
          const parsed = JSON.parse(typeof init?.body === 'string' ? init.body : '[]');
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          upserts.push({ table, rows });
          return Response.json(rows, { status: 201 });
        }
        if (table === 'workflow_v2_cursors') return Response.json(null);
        return Response.json([]);
      },
    },
  });
  return { db, upserts };
}

function fakeMainnetClient(headBlock: bigint): PublicClient {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(headBlock),
    getLogs: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 1_794_787_200n }),
  } as unknown as PublicClient;
}

describe('dual mode & mainnet backend support', () => {
  it('loads mainnet RPC and deployment config and resolves mainnet clients', () => {
    const cfg = loadConfig({
      SUPABASE_URL: 'https://db.example',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      REACTIVE_MAINNET_RPC_URL: 'https://reactive-mainnet.rpc.example/',
      UNICHAIN_MAINNET_RPC_URL: 'https://unichain-mainnet.rpc.example/',
      BASE_MAINNET_RPC_URL: 'https://base-mainnet.rpc.example/',
      WORKFLOW_V2_MAINNET_DEPLOYMENT: JSON.stringify(MAINNET_DEPLOYMENT),
    });

    expect(cfg.REACTIVE_MAINNET_RPC_URL).toBe('https://reactive-mainnet.rpc.example/');
    expect(cfg.UNICHAIN_MAINNET_RPC_URL).toBe('https://unichain-mainnet.rpc.example/');
    expect(cfg.BASE_MAINNET_RPC_URL).toBe('https://base-mainnet.rpc.example/');
    expect(cfg.workflowsV2Mainnet).toEqual(MAINNET_DEPLOYMENT);

    const clients = createChainClients(cfg);
    expect(clientFor(clients, REACTIVE_MAINNET_CHAIN_ID)).toBe(clients.reactiveMainnet);
    expect(clientFor(clients, UNICHAIN_MAINNET_CHAIN_ID)).toBe(clients.unichainMainnet);
    expect(clientFor(clients, BASE_MAINNET_CHAIN_ID)).toBe(clients.baseMainnet);
  });

  it('indexes Reactive Mainnet, Unichain Mainnet, and Base Mainnet cursors', async () => {
    const { db, upserts } = mainnetDbFixture();
    const clients = {
      lasna: fakeMainnetClient(10n),
      unichain: fakeMainnetClient(10n),
      reactiveMainnet: fakeMainnetClient(500n),
      unichainMainnet: fakeMainnetClient(600n),
      baseMainnet: fakeMainnetClient(700n),
    };
    const indexer = new WorkflowV2Indexer(db, clients, MAINNET_DEPLOYMENT, silentLogger);
    await indexer.syncOnce();

    const cursorUpserts = upserts
      .filter((entry) => entry.table === 'workflow_v2_cursors')
      .flatMap((entry) => entry.rows as Array<{ deployment: string; chain: number }>);
    expect(cursorUpserts.map((row) => row.chain).sort((a, b) => a - b)).toEqual([
      UNICHAIN_MAINNET_CHAIN_ID,
      REACTIVE_MAINNET_CHAIN_ID,
      BASE_MAINNET_CHAIN_ID,
    ]);
    expect(
      cursorUpserts.every(
        (row) =>
          row.deployment === workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, REACTIVE_FACTORY),
      ),
    ).toBe(true);
  });

  it('routes /v3 endpoints by ?network and returns empty results when mainnet is unconfigured', async () => {
    const testnetFactory = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
    const owner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const seenUrls: URL[] = [];
    const db = createClient('https://database.example', 'fixture-key', {
      global: {
        fetch: async (input) => {
          seenUrls.push(new URL(String(input)));
          return Response.json([]);
        },
      },
    });
    const app = Fastify();
    registerWorkflowV2Routes(app, db, { testnet: testnetFactory });

    const unconfiguredHealth = await app.inject({
      method: 'GET',
      url: `/v3/health?owner=${owner}&network=mainnet`,
    });
    expect(unconfiguredHealth.statusCode).toBe(200);
    expect(unconfiguredHealth.json()).toEqual({ workflows: [] });
    expect(seenUrls).toHaveLength(0);

    const unconfiguredActivity = await app.inject({
      method: 'GET',
      url: `/v3/activity?owner=${owner}&network=mainnet`,
    });
    expect(unconfiguredActivity.statusCode).toBe(200);
    expect(unconfiguredActivity.json()).toEqual({
      runs: [],
      nextCursor: null,
      previousCursor: null,
    });
    expect(seenUrls).toHaveLength(0);

    const unconfiguredMarketplace = await app.inject({
      method: 'GET',
      url: '/v3/marketplace?network=mainnet',
    });
    expect(unconfiguredMarketplace.statusCode).toBe(200);
    expect(unconfiguredMarketplace.json()).toEqual({ listings: [], nextCursor: null });

    const runNotFound = await app.inject({
      method: 'GET',
      url: `/v3/runs/0x${'1'.repeat(64)}?network=mainnet`,
    });
    expect(runNotFound.statusCode).toBe(404);
    await app.close();
  });

  it('migrates SQL activity view and funding claim functions to support mainnet chains', async () => {
    const db = new PGlite();
    try {
      await db.exec('create role anon; create role authenticated; create role service_role;');
      const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));
      const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();
      for (const file of files) {
        await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      }

      await db.exec(`
        insert into workflow_v2_accounts values
          ('mainnet-deploy', ${REACTIVE_MAINNET_CHAIN_ID}, 'agent-main', 'owner-main', 'agent-main'),
          ('mainnet-deploy', ${UNICHAIN_MAINNET_CHAIN_ID}, 'vault-main-uni', 'owner-main', 'agent-main'),
          ('mainnet-deploy', ${BASE_MAINNET_CHAIN_ID}, 'vault-main-base', 'owner-main', 'agent-main');
        insert into workflow_v2_activations values
          ('mainnet-deploy', ${UNICHAIN_MAINNET_CHAIN_ID}, 'agent-main', 'wf-main', '1', 'hash-m', 'Mainnet DCA');
        insert into workflow_v2_runs values
          ('mainnet-deploy', ${UNICHAIN_MAINNET_CHAIN_ID}, 'run-main', 'agent-main', 'wf-main', 'hash-m', '1', ${BASE_MAINNET_CHAIN_ID}, 'orig', '0', 'rx', 100, 9999999999);
        insert into workflow_v2_outcomes values
          ('mainnet-deploy', ${UNICHAIN_MAINNET_CHAIN_ID}, 'run-main', 'wf-main', 'vault-main-uni', '1', 'dest-main', 50, 0, 1, '0x00000000', 2);
      `);

      const activity = await db.query<{
        id: string;
        status: string;
        destination_transaction: string;
      }>(
        "select id, status, destination_transaction from workflow_v2_activity where deployment = 'mainnet-deploy' and owner = 'owner-main'",
      );
      expect(activity.rows).toEqual([
        { id: 'run-main', status: 'confirmed', destination_transaction: 'dest-main' },
      ]);

      await db.exec(`
        insert into telegram_accounts (automation_chain, agent, chat_id, profile, connection_id, enabled, funding_alerts)
        values (${REACTIVE_MAINNET_CHAIN_ID}, 'agent-main', '12345', 'MainnetUser', gen_random_uuid(), true, true);
      `);
      const claimed = await db.query<{
        telegram_claim_funding: Array<{ agent: string; vault: string | null }>;
      }>(`select telegram_claim_funding('mainnet-deploy', ${REACTIVE_MAINNET_CHAIN_ID}, 5)`);
      expect(claimed.rows[0]?.telegram_claim_funding).toHaveLength(1);
      expect(claimed.rows[0]?.telegram_claim_funding[0]?.agent).toBe('agent-main');

      const claimedUni = await db.query<{
        telegram_claim_funding: Array<{ agent: string; vault: string | null }>;
      }>(`select telegram_claim_funding('mainnet-deploy', ${UNICHAIN_MAINNET_CHAIN_ID}, 5)`);
      expect(claimedUni.rows[0]?.telegram_claim_funding[0]?.vault).toBe('vault-main-uni');
    } finally {
      await db.close();
    }
  });

  it('verifies Telegram ownership on Reactive Mainnet (1597) and isolates Lasna signatures', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const owner = account.address.toLowerCase() as Address;
    const agent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
    const challenge: TelegramChallenge = {
      nonce: `0x${'ab'.repeat(32)}` as Hex,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      origin: 'https://app.example.com',
      proof: 'proof',
    };
    const lasnaSig = await account.signTypedData(telegramSignIn(agent, challenge, LASNA_CHAIN_ID));
    const mainnetSig = await account.signTypedData(
      telegramSignIn(agent, challenge, REACTIVE_MAINNET_CHAIN_ID),
    );
    const reactiveClient = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === 'agentOf' ? agent : owner,
      ),
      verifyTypedData: vi.fn((args: Parameters<typeof verifyTypedData>[0]) =>
        verifyTypedData(args),
      ),
    } as unknown as PublicClient;
    const clients = {
      lasna: { readContract: vi.fn(), verifyTypedData: vi.fn() } as unknown as PublicClient,
      unichain: {} as PublicClient,
      reactiveMainnet: reactiveClient,
    };

    const ownership = telegramOwnership(clients, [
      { chainId: REACTIVE_MAINNET_CHAIN_ID, address: REACTIVE_FACTORY },
    ]);
    expect(
      await ownership.verify(agent, owner, challenge, mainnetSig, REACTIVE_MAINNET_CHAIN_ID),
    ).toBe(true);
    expect(
      await ownership.verify(agent, owner, challenge, lasnaSig, REACTIVE_MAINNET_CHAIN_ID),
    ).toBe(false);
    expect(await ownership.verify(agent, owner, challenge, lasnaSig, LASNA_CHAIN_ID)).toBe(false);
  });

  it('scopes TelegramFundingAlerts strictly to chains matching its automation mode', async () => {
    const claimedChains: number[] = [];
    const mockDb = {
      rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
        if (name === 'telegram_claim_funding') claimedChains.push(Number(params.p_chain));
        return [];
      }),
    };
    const clients = {
      lasna: {} as PublicClient,
      unichain: {} as PublicClient,
      base: {} as PublicClient,
      unichainMainnet: {} as PublicClient,
      baseMainnet: {} as PublicClient,
    };
    const alerts = new TelegramFundingAlerts(
      mockDb,
      clients,
      REACTIVE_FACTORY,
      {
        [UNICHAIN_SEPOLIA_CHAIN_ID]: UNICHAIN_FACTORY,
        [BASE_SEPOLIA_CHAIN_ID]: BASE_FACTORY,
        [UNICHAIN_MAINNET_CHAIN_ID]: UNICHAIN_FACTORY,
        [BASE_MAINNET_CHAIN_ID]: BASE_FACTORY,
      },
      'https://app.example.com',
      LASNA_CHAIN_ID,
    );
    await alerts.process();
    expect(claimedChains.sort((a, b) => a - b)).toEqual([
      UNICHAIN_SEPOLIA_CHAIN_ID,
      BASE_SEPOLIA_CHAIN_ID,
      LASNA_CHAIN_ID,
    ]);
  });

  it('backfills payout alert_data.chain in 0025 and routes dual-mode mainnet payout preflights accurately', async () => {
    const db = new PGlite();
    try {
      await db.exec('create role anon; create role authenticated; create role service_role;');
      const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));
      const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();
      const preFix = files.filter((name) => name < '0025_');
      const payoutChainMigration = files.find((name) => name.startsWith('0025_'));
      const postFix = files.filter((name) => name > '0025_');
      expect(payoutChainMigration).toBeDefined();
      for (const file of preFix) {
        await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      }

      const mainnetAgent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
      const mainnetOwner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
      const uniVault = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
      const baseVault = '0xdddddddddddddddddddddddddddddddddddddddd' as Address;
      const uniWorkflow = `0x${'1'.repeat(64)}` as Hex;
      const baseWorkflow = `0x${'2'.repeat(64)}` as Hex;
      const programHash = `0x${'3'.repeat(64)}` as Hex;
      const uniRun = `0x${'4'.repeat(64)}` as Hex;
      const baseRun = `0x${'5'.repeat(64)}` as Hex;
      const legacyDeadline = Math.floor(Date.now() / 1000) + 3600;

      await db.query(
        `insert into telegram_accounts (agent, chat_id, profile, connection_id, enabled, action_alerts)
          values ($1, '99999', 'MainnetUser', gen_random_uuid(), true, true)`,
        [mainnetAgent],
      );
      const [{ connection_id }] = (
        await db.query<{ connection_id: string }>('select connection_id from telegram_accounts')
      ).rows;
      await db.query(
        `insert into telegram_deliveries
          (agent, connection_id, chain_id, workflow_id, block_time, message, alert_kind, alert_data, alert_key, status)
        values ($1, $2, $3, $4, now(), 'Legacy mainnet warning', 'payout', $5::jsonb, 'legacy-mainnet-key', 'sent')`,
        [
          mainnetAgent,
          connection_id,
          UNICHAIN_MAINNET_CHAIN_ID,
          uniWorkflow,
          JSON.stringify({
            kind: 'payout',
            vault: uniVault,
            workflow: uniWorkflow,
            epoch: '1',
            deadline: legacyDeadline,
            block: '50',
            deployment: REACTIVE_FACTORY,
          }),
        ],
      );

      await db.exec(readFileSync(join(migrationsDir, payoutChainMigration!), 'utf8'));

      const backfilled = await db.query<{ alert_data: { chain?: number } }>(
        `select alert_data from telegram_deliveries where alert_key = 'legacy-mainnet-key'`,
      );
      expect(backfilled.rows[0]?.alert_data.chain).toBe(UNICHAIN_MAINNET_CHAIN_ID);

      for (const file of postFix) {
        await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      }

      const migratedAccount = await db.query<{ automation_chain: number }>(
        `select automation_chain from telegram_accounts where agent = $1`,
        [mainnetAgent],
      );
      expect(migratedAccount.rows).toEqual([{ automation_chain: REACTIVE_MAINNET_CHAIN_ID }]);

      const mainnetDeploymentKey = workflowDeploymentKey(
        REACTIVE_MAINNET_CHAIN_ID,
        REACTIVE_FACTORY,
      );

      await db.query(
        `insert into workflow_v2_accounts (deployment, chain, address, owner, agent) values
          ($1, $2, $5, $6, $5),
          ($1, $3, $7, $6, $5),
          ($1, $4, $8, $6, $5)`,
        [
          mainnetDeploymentKey,
          REACTIVE_MAINNET_CHAIN_ID,
          UNICHAIN_MAINNET_CHAIN_ID,
          BASE_MAINNET_CHAIN_ID,
          mainnetAgent,
          mainnetOwner,
          uniVault,
          baseVault,
        ],
      );
      await db.query(
        `insert into workflow_v2_activations values
          ($1, $2, $4, $5, '1', $7, 'Unichain Mainnet Vault'),
          ($1, $3, $4, $6, '1', $7, 'Base Mainnet Vault')`,
        [
          mainnetDeploymentKey,
          UNICHAIN_MAINNET_CHAIN_ID,
          BASE_MAINNET_CHAIN_ID,
          mainnetAgent,
          uniWorkflow,
          baseWorkflow,
          programHash,
        ],
      );
      await db.query(
        `insert into workflow_v2_runs values
          ($1, $2, $4, $6, $7, $9, '1', $2, $9, '0', $9, 5, extract(epoch from now())::bigint - 180),
          ($1, $3, $5, $6, $8, $9, '1', $3, $9, '0', $9, 5, extract(epoch from now())::bigint - 180)`,
        [
          mainnetDeploymentKey,
          UNICHAIN_MAINNET_CHAIN_ID,
          BASE_MAINNET_CHAIN_ID,
          uniRun,
          baseRun,
          mainnetAgent,
          uniWorkflow,
          baseWorkflow,
          programHash,
        ],
      );
      const txUni = `0x${'6'.repeat(64)}` as Hex;
      const txBase = `0x${'7'.repeat(64)}` as Hex;
      await db.query(
        `insert into workflow_v2_outcomes (deployment, chain, run_id, workflow_id, vault, epoch,
          transaction_hash, block_number, log_index, status, reason, telegram_block_time) values
          ($1, $2, $4, $6, $8, '1', $10, 100, 0, 6, '0x00000000', clock_timestamp()),
          ($1, $3, $5, $7, $9, '1', $11, 200, 0, 6, '0x00000000', clock_timestamp())`,
        [
          mainnetDeploymentKey,
          UNICHAIN_MAINNET_CHAIN_ID,
          BASE_MAINNET_CHAIN_ID,
          uniRun,
          baseRun,
          uniWorkflow,
          baseWorkflow,
          uniVault,
          baseVault,
          txUni,
          txBase,
        ],
      );

      const dbAdapter: Pick<
        TelegramDatabase,
        'rpc' | 'createSession' | 'session' | 'forgetBrowser'
      > = {
        async rpc(name, params, schema) {
          const entries = Object.entries(params);
          const argsSql = entries.map(([k], i) => `${k} => $${i + 1}`).join(', ');
          const values = entries.map(([, v]) => v);
          if (
            [
              'telegram_claim',
              'telegram_claim_alert_delivery',
              'telegram_prepare',
              'telegram_pending_notifications',
            ].includes(name)
          ) {
            return schema.parse(
              JSON.parse(
                JSON.stringify((await db.query(`select * from ${name}(${argsSql})`, values)).rows),
              ),
            );
          }
          const { rows } = await db.query<{ result: unknown }>(
            `select ${name}(${argsSql}) as result`,
            values,
          );
          return schema.parse(rows[0]?.result === '' ? null : rows[0]?.result);
        },
        createSession: async () => false,
        session: async () => null,
        forgetBrowser: async () => {},
      };

      const mainnetDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const queriedByChain: number[] = [];
      const makeClient = (chainId: number, activeDeadline: bigint) =>
        ({
          getTransactionReceipt: async () => ({ blockNumber: 100n, logs: [] }),
          readContract: async ({ abi, functionName }: { abi: unknown; functionName: string }) => {
            expect(abi).toBe(workflowVaultV2Abi);
            queriedByChain.push(chainId);
            return functionName === 'authorizations'
              ? [programHash, 1n, 1n, true]
              : [0n, 0n, 0n, 0n, activeDeadline, 0n, 0n, false];
          },
          getBlock: async () => {
            queriedByChain.push(chainId);
            return { number: 300n, timestamp: BigInt(Math.floor(Date.now() / 1000)) };
          },
        }) as unknown as PublicClient;

      const clients = {
        lasna: makeClient(LASNA_CHAIN_ID, 0n),
        unichain: makeClient(UNICHAIN_SEPOLIA_CHAIN_ID, 0n),
        base: makeClient(BASE_SEPOLIA_CHAIN_ID, 0n),
        reactiveMainnet: makeClient(REACTIVE_MAINNET_CHAIN_ID, 0n),
        unichainMainnet: makeClient(UNICHAIN_MAINNET_CHAIN_ID, mainnetDeadline),
        baseMainnet: makeClient(BASE_MAINNET_CHAIN_ID, mainnetDeadline),
      };

      const testnetFactory = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address;
      const testnetAlerts = new WorkflowTelegramAlerts(
        dbAdapter,
        clients,
        testnetFactory,
        'https://app.example.com',
        [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
      );
      const mainnetAlerts = new WorkflowTelegramAlerts(
        dbAdapter,
        clients,
        REACTIVE_FACTORY,
        'https://app.example.com',
        [UNICHAIN_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID],
      );

      await mainnetAlerts.process();
      const queuedRows = (
        await db.query<{ chain_id: number; alert_data: unknown }>(
          `select chain_id, alert_data from telegram_deliveries where alert_kind = 'payout' and status = 'pending' order by chain_id`,
        )
      ).rows;
      expect(queuedRows).toHaveLength(2);
      expect(payoutPreflight.parse(queuedRows[0]?.alert_data).chain).toBe(
        UNICHAIN_MAINNET_CHAIN_ID,
      );
      expect(payoutPreflight.parse(queuedRows[1]?.alert_data).chain).toBe(BASE_MAINNET_CHAIN_ID);

      const sentMessages: string[] = [];
      const transport: typeof fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { text: string };
        sentMessages.push(body.text);
        return Response.json({ ok: true });
      };
      const service = new TelegramService(
        {
          botUsername: 'RulebookBot',
          botToken: 'test-token',
          webhookSecret: 'a'.repeat(32),
          appOrigin: 'https://app.example.com',
          factories: [REACTIVE_FACTORY],
          factoryTargets: [{ chainId: REACTIVE_MAINNET_CHAIN_ID, address: REACTIVE_FACTORY }],
        },
        dbAdapter,
        { verify: async () => true },
        [testnetAlerts, mainnetAlerts],
      );
      const warnings: string[] = [];
      const logger = {
        info() {},
        warn(msg: string) {
          warnings.push(msg);
        },
      };
      const worker = new TelegramWorker(
        dbAdapter as unknown as TelegramDatabase,
        service,
        logger,
        [testnetAlerts, mainnetAlerts],
        undefined,
        transport,
      );

      queriedByChain.length = 0;
      expect(await worker.deliverOnce()).toBe(true);
      expect(await worker.deliverOnce()).toBe(true);
      expect(sentMessages).toHaveLength(2);
      expect(sentMessages.some((m) => m.includes('Unichain Mainnet Vault'))).toBe(true);
      expect(sentMessages.some((m) => m.includes('Base Mainnet Vault'))).toBe(true);
      expect(queriedByChain).toContain(UNICHAIN_MAINNET_CHAIN_ID);
      expect(queriedByChain).toContain(BASE_MAINNET_CHAIN_ID);
      expect(queriedByChain).not.toContain(UNICHAIN_SEPOLIA_CHAIN_ID);
      expect(warnings).toEqual([]);

      const statuses = (
        await db.query<{ status: string }>(
          `select status from telegram_deliveries where alert_kind = 'payout' and alert_key <> 'legacy-mainnet-key'`,
        )
      ).rows;
      expect(statuses).toEqual([{ status: 'sent' }, { status: 'sent' }]);

      // Verify that an unhandled chain retries instead of falling back to another runner and cancelling.
      await db.query(
        `insert into telegram_deliveries
          (automation_chain, agent, connection_id, chain_id, workflow_id, block_time, message, alert_kind, alert_data, alert_key)
        values ($1, $2, $3, $4, $5, now(), 'Base warning without handler', 'payout', $6::jsonb, 'unhandled-base-key')`,
        [
          REACTIVE_MAINNET_CHAIN_ID,
          mainnetAgent,
          connection_id,
          BASE_MAINNET_CHAIN_ID,
          baseWorkflow,
          JSON.stringify({
            kind: 'payout',
            chain: BASE_MAINNET_CHAIN_ID,
            vault: baseVault,
            workflow: baseWorkflow,
            epoch: '1',
            deadline: Number(mainnetDeadline),
            block: '200',
            deployment: mainnetDeploymentKey,
          }),
        ],
      );
      const uniOnlyMainnetAlerts = new WorkflowTelegramAlerts(
        dbAdapter,
        clients,
        REACTIVE_FACTORY,
        'https://app.example.com',
        [UNICHAIN_MAINNET_CHAIN_ID],
      );
      const partialWorker = new TelegramWorker(
        dbAdapter as unknown as TelegramDatabase,
        service,
        logger,
        [testnetAlerts, uniOnlyMainnetAlerts],
        undefined,
        transport,
      );
      queriedByChain.length = 0;
      expect(await partialWorker.deliverOnce()).toBe(true);
      expect(queriedByChain).toEqual([]);
      expect(warnings).toContain(
        `No workflow alert runner configured for chain ${BASE_MAINNET_CHAIN_ID}`,
      );
      const unhandledRow = (
        await db.query<{ status: string }>(
          `select status from telegram_deliveries where alert_key = 'unhandled-base-key'`,
        )
      ).rows[0];
      expect(unhandledRow?.status).toBe('pending');
    } finally {
      await db.close();
    }
  });

  it('preserves per-chain factory targets in config even when Lasna and Mainnet factories collide and parses chain-prefixed legacy factories', () => {
    const collidingFactory = '0x5555555555555555555555555555555555555555' as Address;
    const legacyMainnetFactory = '0x6666666666666666666666666666666666666666' as Address;
    const legacyLasnaFactory = '0x7777777777777777777777777777777777777777' as Address;
    const cfg = loadConfig({
      SUPABASE_URL: 'https://db.example',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      CORS_ORIGINS: 'https://app.example.com',
      TELEGRAM_BOT_TOKEN: '123456:token_value',
      TELEGRAM_BOT_USERNAME: 'RulebookBot',
      TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
      TELEGRAM_APP_ORIGIN: 'https://app.example.com',
      TELEGRAM_AGENT_FACTORIES: `${REACTIVE_MAINNET_CHAIN_ID}:${legacyMainnetFactory},${legacyLasnaFactory}`,
      WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
        lasna: { factory: collidingFactory, startBlock: 10 },
        unichain: { factory: UNICHAIN_FACTORY, startBlock: 20 },
      }),
      WORKFLOW_V2_MAINNET_DEPLOYMENT: JSON.stringify({
        reactive: { factory: collidingFactory, startBlock: 10 },
        unichain: { factory: UNICHAIN_FACTORY, startBlock: 20 },
      }),
    });

    expect(cfg.telegram?.factoryTargets).toEqual([
      { chainId: REACTIVE_MAINNET_CHAIN_ID, address: legacyMainnetFactory },
      { chainId: LASNA_CHAIN_ID, address: legacyLasnaFactory },
      { chainId: LASNA_CHAIN_ID, address: collidingFactory },
      { chainId: REACTIVE_MAINNET_CHAIN_ID, address: collidingFactory },
    ]);

    expect(() =>
      loadConfig({
        SUPABASE_URL: 'https://db.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        CORS_ORIGINS: 'https://app.example.com',
        TELEGRAM_BOT_TOKEN: '123456:token_value',
        TELEGRAM_BOT_USERNAME: 'RulebookBot',
        TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
        TELEGRAM_APP_ORIGIN: 'https://app.example.com',
        TELEGRAM_AGENT_FACTORIES: `999999:${legacyLasnaFactory}`,
      }),
    ).toThrow(ConfigError);
  });

  it('prevents cross-environment Telegram takeover and alert leakage when factory and agent addresses collide', async () => {
    const alice = privateKeyToAccount(generatePrivateKey());
    const bob = privateKeyToAccount(generatePrivateKey());
    const aliceAddr = alice.address.toLowerCase() as Address;
    const bobAddr = bob.address.toLowerCase() as Address;
    const sharedFactory = '0x5555555555555555555555555555555555555555' as Address;
    const sharedAgent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
    const legacyMainnetFactory = '0x6666666666666666666666666666666666666666' as Address;
    const legacyMainnetAgent = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;

    const makeChainClient = (
      factories: Record<string, Record<string, Address>>,
      owners: Record<string, Address>,
    ) =>
      ({
        readContract: vi.fn(
          async ({
            address,
            functionName,
            args,
          }: {
            address: Address;
            functionName: string;
            args?: [Address];
          }) => {
            if (functionName === 'agentOf') {
              return (
                factories[address.toLowerCase()]?.[args![0].toLowerCase()] ??
                ('0x0000000000000000000000000000000000000000' as Address)
              );
            }
            return (
              owners[address.toLowerCase()] ??
              ('0x0000000000000000000000000000000000000000' as Address)
            );
          },
        ),
        verifyTypedData: vi.fn((args: Parameters<typeof verifyTypedData>[0]) =>
          verifyTypedData(args),
        ),
        getTransactionReceipt: vi.fn(async () => ({ blockNumber: 100n, logs: [] })),
        getBlock: vi.fn(async () => ({
          number: 20n,
          timestamp: BigInt(Math.floor(Date.now() / 1000)),
        })),
      }) as unknown as PublicClient;

    const clients = {
      lasna: makeChainClient(
        { [sharedFactory]: { [aliceAddr]: sharedAgent } },
        { [sharedAgent]: aliceAddr },
      ),
      unichain: makeChainClient({}, {}),
      reactiveMainnet: makeChainClient(
        {
          [sharedFactory]: { [bobAddr]: sharedAgent },
          [legacyMainnetFactory]: { [bobAddr]: legacyMainnetAgent },
        },
        {
          [sharedAgent]: bobAddr,
          [legacyMainnetAgent]: bobAddr,
        },
      ),
      unichainMainnet: makeChainClient({}, {}),
    };

    const ownership = telegramOwnership(clients, [
      { chainId: LASNA_CHAIN_ID, address: sharedFactory },
      { chainId: REACTIVE_MAINNET_CHAIN_ID, address: sharedFactory },
      { chainId: REACTIVE_MAINNET_CHAIN_ID, address: legacyMainnetFactory },
    ]);

    const probeChallenge: TelegramChallenge = {
      nonce: `0x${'ab'.repeat(32)}` as Hex,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      origin: 'https://app.example.com',
      proof: 'a'.repeat(64),
    };
    const aliceLasnaSig = await alice.signTypedData(
      telegramSignIn(sharedAgent, probeChallenge, LASNA_CHAIN_ID),
    );
    const aliceMainnetSig = await alice.signTypedData(
      telegramSignIn(sharedAgent, probeChallenge, REACTIVE_MAINNET_CHAIN_ID),
    );
    const bobMainnetSig = await bob.signTypedData(
      telegramSignIn(sharedAgent, probeChallenge, REACTIVE_MAINNET_CHAIN_ID),
    );
    const bobLegacyMainnetSig = await bob.signTypedData(
      telegramSignIn(legacyMainnetAgent, probeChallenge, REACTIVE_MAINNET_CHAIN_ID),
    );

    expect(
      await ownership.verify(sharedAgent, aliceAddr, probeChallenge, aliceLasnaSig, LASNA_CHAIN_ID),
    ).toBe(true);
    expect(
      await ownership.verify(
        sharedAgent,
        aliceAddr,
        probeChallenge,
        aliceMainnetSig,
        REACTIVE_MAINNET_CHAIN_ID,
      ),
    ).toBe(false);
    expect(
      await ownership.verify(
        sharedAgent,
        bobAddr,
        probeChallenge,
        bobMainnetSig,
        REACTIVE_MAINNET_CHAIN_ID,
      ),
    ).toBe(true);
    expect(
      await ownership.verify(sharedAgent, bobAddr, probeChallenge, bobMainnetSig, LASNA_CHAIN_ID),
    ).toBe(false);
    expect(
      await ownership.verify(
        legacyMainnetAgent,
        bobAddr,
        probeChallenge,
        bobLegacyMainnetSig,
        REACTIVE_MAINNET_CHAIN_ID,
      ),
    ).toBe(true);
    expect(
      await ownership.verify(
        legacyMainnetAgent,
        bobAddr,
        probeChallenge,
        bobLegacyMainnetSig,
        LASNA_CHAIN_ID,
      ),
    ).toBe(false);

    const db = new PGlite();
    try {
      await db.exec('create role anon; create role authenticated; create role service_role;');
      const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));
      const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();
      for (const file of files) {
        await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      }

      const { createHash } = await import('node:crypto');
      const digest = (value: string) => createHash('sha256').update(value).digest('hex');
      const dbAdapter: Pick<
        TelegramDatabase,
        'rpc' | 'createSession' | 'session' | 'forgetBrowser'
      > = {
        async rpc(name, params, schema) {
          const entries = Object.entries(params);
          const argsSql = entries.map(([k], i) => `${k} => $${i + 1}`).join(', ');
          const values = entries.map(([, v]) => v);
          if (
            [
              'telegram_claim',
              'telegram_claim_alert_delivery',
              'telegram_prepare',
              'telegram_pending_notifications',
            ].includes(name)
          ) {
            return schema.parse(
              JSON.parse(
                JSON.stringify((await db.query(`select * from ${name}(${argsSql})`, values)).rows),
              ),
            );
          }
          const { rows } = await db.query<{ result: unknown }>(
            `select ${name}(${argsSql}) as result`,
            values,
          );
          return schema.parse(rows[0]?.result === '' ? null : rows[0]?.result);
        },
        async createSession(nonce, target, token, expiresAt, automationChain = LASNA_CHAIN_ID) {
          const { affectedRows } = await db.query(
            `insert into telegram_sessions (nonce, token_hash, agent, expires_at, automation_chain)
            values ($1, $2, $3, to_timestamp($4), $5) on conflict do nothing`,
            [nonce, digest(token), target, expiresAt, automationChain],
          );
          return affectedRows === 1;
        },
        async session(target, token, browser = false, automationChain = LASNA_CHAIN_ID) {
          const tokenHash = digest(token);
          const { rows } = await db.query<{ expires: number | null }>(
            `select extract(epoch from expires_at)::int as expires from telegram_sessions
            where automation_chain = $1 and agent = $2 and token_hash = $3
              and case when $4 then expires_at is null else expires_at > now() end`,
            [automationChain, target, tokenHash, browser],
          );
          return rows[0] ? { hash: tokenHash, expiresAt: rows[0].expires } : null;
        },
        async forgetBrowser(target, token, automationChain = LASNA_CHAIN_ID) {
          await db.query(
            `update telegram_sessions set token_hash = gen_random_uuid()::text,
              expires_at = now() + interval '5 minutes'
            where automation_chain = $1 and agent = $2 and token_hash = $3 and expires_at is null`,
            [automationChain, target, digest(token)],
          );
        },
      };

      const testnetAlerts = new WorkflowTelegramAlerts(
        dbAdapter,
        clients,
        sharedFactory,
        'https://app.example.com',
        [UNICHAIN_SEPOLIA_CHAIN_ID],
      );
      const mainnetAlerts = new WorkflowTelegramAlerts(
        dbAdapter,
        clients,
        sharedFactory,
        'https://app.example.com',
        [UNICHAIN_MAINNET_CHAIN_ID],
      );
      const service = new TelegramService(
        {
          botUsername: 'RulebookBot',
          botToken: 'test-token',
          webhookSecret: 'a'.repeat(32),
          appOrigin: 'https://app.example.com',
          factories: [sharedFactory, legacyMainnetFactory],
          factoryTargets: [
            { chainId: LASNA_CHAIN_ID, address: sharedFactory },
            { chainId: REACTIVE_MAINNET_CHAIN_ID, address: sharedFactory },
            { chainId: REACTIVE_MAINNET_CHAIN_ID, address: legacyMainnetFactory },
          ],
        },
        dbAdapter,
        ownership,
        [testnetAlerts, mainnetAlerts],
      );

      const app = Fastify();
      registerTelegramRoutes(app, {
        config: {
          PORT: 8787,
          NODE_ENV: 'test',
          SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'unused',
          LASNA_RPC_URL: 'https://lasna-rpc.rnk.dev/',
          UNICHAIN_RPC_URL: 'https://sepolia.unichain.org',
          BASE_SEPOLIA_RPC_URL: 'https://sepolia.base.org',
          REACTIVE_MAINNET_RPC_URL: 'https://mainnet-rpc.rnk.dev/',
          UNICHAIN_MAINNET_RPC_URL: 'https://mainnet.unichain.org',
          BASE_MAINNET_RPC_URL: 'https://mainnet.base.org',
          INDEXER_ENABLED: false,
          corsOrigins: ['https://app.example.com'],
        },
        databaseReachable: async () => true,
        rpcHealth: async () => [],
        telegram: service,
      });

      const baseRoute = `/v1/accounts/${sharedAgent}/telegram`;
      const origin = 'https://app.example.com';

      const aliceChallengeRes = await app.inject({
        method: 'POST',
        url: `${baseRoute}/challenge?network=testnet`,
        headers: { origin },
        payload: { owner: aliceAddr, browser: true },
      });
      const aliceChallenge = aliceChallengeRes.json<TelegramChallenge>();
      const aliceChallengeSig = await alice.signTypedData(
        telegramSignIn(sharedAgent, aliceChallenge, LASNA_CHAIN_ID),
      );
      // Cross-network challenge replay is rejected.
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `${baseRoute}/session?network=mainnet`,
            headers: { origin },
            payload: { owner: aliceAddr, challenge: aliceChallenge, signature: aliceChallengeSig },
          })
        ).statusCode,
      ).toBe(401);

      const aliceSessionRes = await app.inject({
        method: 'POST',
        url: `${baseRoute}/session?network=testnet`,
        headers: { origin },
        payload: { owner: aliceAddr, challenge: aliceChallenge, signature: aliceChallengeSig },
      });
      expect(aliceSessionRes.statusCode).toBe(200);
      const aliceCookie = String(aliceSessionRes.headers['set-cookie']).split(';')[0]!;
      expect(aliceCookie).toMatch(/^__Secure-rulebook-telegram=/);

      const bobChallengeRes = await app.inject({
        method: 'POST',
        url: `${baseRoute}/challenge?network=mainnet`,
        headers: { origin },
        payload: { owner: bobAddr, browser: true },
      });
      const bobChallenge = bobChallengeRes.json<TelegramChallenge>();
      const bobChallengeSig = await bob.signTypedData(
        telegramSignIn(sharedAgent, bobChallenge, REACTIVE_MAINNET_CHAIN_ID),
      );
      const bobSessionRes = await app.inject({
        method: 'POST',
        url: `${baseRoute}/session?network=mainnet`,
        headers: { origin },
        payload: { owner: bobAddr, challenge: bobChallenge, signature: bobChallengeSig },
      });
      expect(bobSessionRes.statusCode).toBe(200);
      const bobCookie = String(bobSessionRes.headers['set-cookie']).split(';')[0]!;
      expect(bobCookie).toMatch(/^__Secure-rulebook-telegram-mainnet=/);

      // Cookies never cross environment boundaries.
      expect(
        (
          await app.inject({
            url: `${baseRoute}?network=mainnet`,
            headers: { cookie: aliceCookie },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ url: `${baseRoute}?network=testnet`, headers: { cookie: bobCookie } }))
          .statusCode,
      ).toBe(401);

      // Pair Alice on testnet (chat 111) and Bob on mainnet (chat 222) for the same agent address.
      const alicePair = await app.inject({
        method: 'POST',
        url: `${baseRoute}/pairing?network=testnet`,
        headers: { origin, cookie: aliceCookie },
      });
      const aliceCode = new URL(alicePair.json().url).searchParams.get('start');
      await app.inject({
        method: 'POST',
        url: '/v1/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'a'.repeat(32) },
        payload: {
          update_id: 1,
          message: {
            chat: { id: 111, type: 'private' },
            from: { id: 111, is_bot: false, first_name: 'Alice', username: 'alice_test' },
            text: `/start ${aliceCode}`,
          },
        },
      });
      const alicePending = (
        await app.inject({ url: `${baseRoute}?network=testnet`, headers: { cookie: aliceCookie } })
      ).json().pendingPairing;
      await app.inject({
        method: 'POST',
        url: `${baseRoute}/pairing/confirm?network=testnet`,
        headers: { origin, cookie: aliceCookie },
        payload: { pairingId: alicePending.id },
      });

      const bobPair = await app.inject({
        method: 'POST',
        url: `${baseRoute}/pairing?network=mainnet`,
        headers: { origin, cookie: bobCookie },
      });
      const bobCode = new URL(bobPair.json().url).searchParams.get('start');
      await app.inject({
        method: 'POST',
        url: '/v1/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'a'.repeat(32) },
        payload: {
          update_id: 2,
          message: {
            chat: { id: 222, type: 'private' },
            from: { id: 222, is_bot: false, first_name: 'Bob', username: 'bob_main' },
            text: `/start ${bobCode}`,
          },
        },
      });
      const bobPending = (
        await app.inject({ url: `${baseRoute}?network=mainnet`, headers: { cookie: bobCookie } })
      ).json().pendingPairing;
      await app.inject({
        method: 'POST',
        url: `${baseRoute}/pairing/confirm?network=mainnet`,
        headers: { origin, cookie: bobCookie },
        payload: { pairingId: bobPending.id },
      });

      // Seed testnet & mainnet workflows under the colliding factory & colliding agent.
      const testnetDeployment = workflowDeploymentKey(LASNA_CHAIN_ID, sharedFactory);
      const mainnetDeployment = workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, sharedFactory);
      const wfId = `0x${'1'.repeat(64)}` as Hex;
      const runMain = `0x${'4'.repeat(64)}` as Hex;
      const hashMain = `0x${'3'.repeat(64)}` as Hex;
      const uniVault = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
      await db.query(
        `insert into workflow_v2_accounts (deployment, chain, address, owner, agent) values
          ($1, ${LASNA_CHAIN_ID}, $3, $4, $3),
          ($1, ${UNICHAIN_SEPOLIA_CHAIN_ID}, $6, $4, $3),
          ($2, ${REACTIVE_MAINNET_CHAIN_ID}, $3, $5, $3),
          ($2, ${UNICHAIN_MAINNET_CHAIN_ID}, $6, $5, $3)`,
        [testnetDeployment, mainnetDeployment, sharedAgent, aliceAddr, bobAddr, uniVault],
      );
      await db.query(
        `insert into workflow_v2_activations values
          ($1, ${UNICHAIN_SEPOLIA_CHAIN_ID}, $3, $4, '1', $5, 'Testnet Workflow'),
          ($2, ${UNICHAIN_MAINNET_CHAIN_ID}, $3, $4, '1', $5, 'Mainnet Workflow')`,
        [testnetDeployment, mainnetDeployment, sharedAgent, wfId, hashMain],
      );
      await db.query(
        `insert into workflow_v2_runs values
          ($1, ${UNICHAIN_MAINNET_CHAIN_ID}, $2, $3, $4, $5, '1', ${UNICHAIN_MAINNET_CHAIN_ID}, $5, '0', $5, 5, extract(epoch from now())::bigint + 3600)`,
        [mainnetDeployment, runMain, sharedAgent, wfId, hashMain],
      );
      await db.query(
        `insert into workflow_v2_outcomes (deployment, chain, run_id, workflow_id, vault, epoch,
          transaction_hash, block_number, log_index, status, reason, telegram_block_time) values
          ($1, ${UNICHAIN_MAINNET_CHAIN_ID}, $2, $3, $4, '1', $5, 100, 0, 1, '0x00000000', clock_timestamp())`,
        [mainnetDeployment, runMain, wfId, uniVault, hashMain],
      );

      // Alice disconnects & mutes on testnet; Bob's mainnet settings and alerts stay completely intact.
      await app.inject({
        method: 'PATCH',
        url: `${baseRoute}/preferences?network=testnet`,
        headers: { origin, cookie: aliceCookie },
        payload: { workflowId: wfId, preference: 'mute' },
      });
      await app.inject({
        method: 'DELETE',
        url: `${baseRoute}/connection?network=testnet`,
        headers: { origin, cookie: aliceCookie },
      });

      const bobStatus = (
        await app.inject({ url: `${baseRoute}?network=mainnet`, headers: { cookie: bobCookie } })
      ).json();
      expect(bobStatus.connection).toBe('connected');
      expect(bobStatus.profile).toBe('@bob_main');
      expect(bobStatus.workflows).toEqual([
        { id: wfId, title: 'Mainnet Workflow', preference: 'inherit' },
      ]);

      await service.processNotifications();
      const [claim] = await dbAdapter.rpc(
        'telegram_claim_alert_delivery',
        { p_deployment: mainnetDeployment },
        z.array(z.object({ id: z.string(), lease: z.string() })),
      );
      expect(claim).toBeDefined();
      const [prepared] = await dbAdapter.rpc(
        'telegram_prepare',
        { p_id: claim!.id, p_lease: claim!.lease },
        z.array(z.object({ chat_id: z.string(), message: z.string() })),
      );
      expect(prepared?.chat_id).toBe('222');
      expect(prepared?.message).toContain('Mainnet Workflow');

      const seenProxyRequests: string[] = [];
      const injectFetch: typeof fetch = async (input, init) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL ? String(input) : input.url,
        );
        const method = init?.method ?? 'GET';
        seenProxyRequests.push(`${method} ${url.pathname}${url.search}`);
        const requestHeaders: Record<string, string> = {};
        new Headers(init?.headers).forEach((value, key) => {
          requestHeaders[key] = value;
        });
        const injected = await app.inject({
          method: method as 'GET' | 'DELETE' | 'POST' | 'PATCH' | 'PUT' | 'HEAD' | 'OPTIONS',
          url: `${url.pathname}${url.search}`,
          headers: requestHeaders,
        });
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(injected.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const entry of value) responseHeaders.append(key, String(entry));
          } else {
            responseHeaders.set(key, String(value));
          }
        }
        return new Response(injected.statusCode === 204 ? null : injected.body, {
          status: injected.statusCode,
          headers: responseHeaders,
        });
      };
      await verifyTelegramProxy({ web: origin, hasMainnet: true, fetchImpl: injectFetch });
      const zeroAddress = `0x${'0'.repeat(40)}`;
      expect(seenProxyRequests).toContain(`DELETE /v1/accounts/${zeroAddress}/telegram/session`);
      expect(seenProxyRequests).toContain(
        `DELETE /v1/accounts/${zeroAddress}/telegram/session?network=mainnet`,
      );
      await app.close();
    } finally {
      await db.close();
    }
  });

  it('migrates pre-0026 bare deployments, mainnet-only Telegram accounts, and colliding agents safely in 0026', async () => {
    const db = new PGlite();
    try {
      await db.exec('create role anon; create role authenticated; create role service_role;');
      const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));
      const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();
      for (const file of files.filter((name) => name < '0026_')) {
        await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      }

      const bareFactory = '0x5555555555555555555555555555555555555555';
      const mainnetOnlyAgent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const collidingAgent = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      await db.query(
        `insert into workflow_v2_cursors (deployment, chain, block_number, block_time) values
          ($1, ${LASNA_CHAIN_ID}, 500, now()),
          ($2, ${LASNA_CHAIN_ID}, 300, now() - interval '1 minute')`,
        [bareFactory, `${LASNA_CHAIN_ID}:${bareFactory}`],
      );
      await db.query(
        `insert into workflow_v2_accounts (deployment, chain, address, owner, agent) values
          ($1, ${REACTIVE_MAINNET_CHAIN_ID}, $2, 'owner-m', $2),
          ($1, ${LASNA_CHAIN_ID}, $3, 'owner-t', $3),
          ($1, ${REACTIVE_MAINNET_CHAIN_ID}, $3, 'owner-m2', $3)`,
        [bareFactory, mainnetOnlyAgent, collidingAgent],
      );
      await db.query(
        `insert into workflow_v2_market_listings values
          ($1, ${UNICHAIN_SEPOLIA_CHAIN_ID}, '1', 'owner-t', $2, $3, $3, '0x01', 'Testnet Listing', 'Desc', true, 10, 0)`,
        [bareFactory, collidingAgent, `0x${'1'.repeat(64)}`],
      );
      await db.query(
        `insert into telegram_accounts (agent, connection_id, chat_id, profile, enabled) values
          ($1, gen_random_uuid(), '1001', '@mainnet_only', true),
          ($2, gen_random_uuid(), '2002', '@colliding_testnet', true)`,
        [mainnetOnlyAgent, collidingAgent],
      );
      const [{ connection_id: mainnetOnlyConn }] = (
        await db.query<{ connection_id: string }>(
          `select connection_id from telegram_accounts where agent = $1`,
          [mainnetOnlyAgent],
        )
      ).rows;
      await db.query(
        `insert into telegram_deliveries
          (agent, connection_id, chain_id, block_time, message, status)
        values
          ($1, $2, null, now(), 'Mainnet test message', 'sent')`,
        [mainnetOnlyAgent, mainnetOnlyConn],
      );
      const [{ connection_id: collidingConn }] = (
        await db.query<{ connection_id: string }>(
          `select connection_id from telegram_accounts where agent = $1`,
          [collidingAgent],
        )
      ).rows;
      await db.query(
        `insert into telegram_deliveries
          (agent, connection_id, chain_id, block_time, message, status, alert_kind, alert_data, alert_key)
        values
          ($1, $2, ${UNICHAIN_MAINNET_CHAIN_ID}, now(), 'Colliding mainnet alert', 'pending', 'unfinished', $3::jsonb, $4)`,
        [
          collidingAgent,
          collidingConn,
          JSON.stringify({ deployment: bareFactory, run: `0x${'9'.repeat(64)}` }),
          `${bareFactory}:unfinished:0x${'9'.repeat(64)}`,
        ],
      );

      for (const file of files.filter((name) => name >= '0026_')) {
        await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      }

      const cursors = await db.query<{ deployment: string; chain: number; block_number: string }>(
        `select deployment, chain, block_number::text from workflow_v2_cursors`,
      );
      expect(cursors.rows).toEqual([
        {
          deployment: `${LASNA_CHAIN_ID}:${bareFactory}`,
          chain: LASNA_CHAIN_ID,
          block_number: '500',
        },
      ]);

      const listings = await db.query<{ deployment: string }>(
        `select deployment from workflow_v2_market_listings`,
      );
      expect(listings.rows).toEqual([{ deployment: `${LASNA_CHAIN_ID}:${bareFactory}` }]);

      const mainnetOnlyRow = await db.query<{ automation_chain: number; chat_id: string | null }>(
        `select automation_chain, chat_id from telegram_accounts where agent = $1`,
        [mainnetOnlyAgent],
      );
      expect(mainnetOnlyRow.rows).toEqual([
        { automation_chain: REACTIVE_MAINNET_CHAIN_ID, chat_id: '1001' },
      ]);

      const collidingRows = await db.query<{
        automation_chain: number;
        chat_id: string | null;
        enabled: boolean;
      }>(
        `select automation_chain, chat_id, enabled from telegram_accounts where agent = $1 order by automation_chain`,
        [collidingAgent],
      );
      expect(collidingRows.rows).toEqual([
        { automation_chain: REACTIVE_MAINNET_CHAIN_ID, chat_id: null, enabled: false },
        { automation_chain: LASNA_CHAIN_ID, chat_id: '2002', enabled: true },
      ]);

      const deliveryRow = await db.query<{
        automation_chain: number;
        status: string;
        alert_data: { deployment?: string };
        alert_key: string;
      }>(
        `select automation_chain, status, alert_data, alert_key from telegram_deliveries where agent = $1`,
        [collidingAgent],
      );
      expect(deliveryRow.rows[0]).toMatchObject({
        automation_chain: REACTIVE_MAINNET_CHAIN_ID,
        status: 'cancelled',
        alert_data: { deployment: `${REACTIVE_MAINNET_CHAIN_ID}:${bareFactory}` },
        alert_key: `${REACTIVE_MAINNET_CHAIN_ID}:${bareFactory}:unfinished:0x${'9'.repeat(64)}`,
      });

      const mainnetTestDelivery = await db.query<{ automation_chain: number }>(
        `select automation_chain from telegram_deliveries where agent = $1 and chain_id is null`,
        [mainnetOnlyAgent],
      );
      expect(mainnetTestDelivery.rows).toEqual([{ automation_chain: REACTIVE_MAINNET_CHAIN_ID }]);

      const ready = await db.query<{ telegram_operational_ready: boolean }>(
        `select telegram_operational_ready()`,
      );
      expect(ready.rows[0]?.telegram_operational_ready).toBe(true);

      const uniOnlyMainnetFunding = new TelegramFundingAlerts(
        { rpc: vi.fn() },
        { lasna: {} as PublicClient, unichain: {} as PublicClient },
        REACTIVE_FACTORY,
        { [UNICHAIN_MAINNET_CHAIN_ID]: UNICHAIN_FACTORY },
        'https://app.example.com',
        REACTIVE_MAINNET_CHAIN_ID,
      );
      expect(uniOnlyMainnetFunding.handlesChain(UNICHAIN_MAINNET_CHAIN_ID)).toBe(true);
      expect(uniOnlyMainnetFunding.handlesChain(BASE_MAINNET_CHAIN_ID)).toBe(false);

      const availabilityService = new TelegramService(
        {
          botUsername: 'RulebookBot',
          botToken: 'test-token',
          webhookSecret: 'a'.repeat(32),
          appOrigin: 'https://app.example.com',
          factories: [REACTIVE_FACTORY],
          factoryTargets: [{ chainId: REACTIVE_MAINNET_CHAIN_ID, address: REACTIVE_FACTORY }],
        },
        {
          rpc: vi.fn(async () => true) as never,
          createSession: async () => false,
          session: async () => null,
          forgetBrowser: async () => {},
        },
        { verify: async () => false },
      );
      await expect(availabilityService.ready(false, REACTIVE_MAINNET_CHAIN_ID)).resolves.toBe(
        false,
      );
    } finally {
      await db.close();
    }
  });

  it('includes ?network=mainnet in Mainnet Telegram alerts, SQL notifications, and skips unconfigured testnet /health pings', async () => {
    const db = new PGlite();
    try {
      await db.exec('create role anon; create role authenticated; create role service_role;');
      const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));
      const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();
      for (const file of files) {
        await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      }

      const mainnetDeploymentKey = workflowDeploymentKey(
        REACTIVE_MAINNET_CHAIN_ID,
        REACTIVE_FACTORY,
      );
      const mainnetAgent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
      const mainnetOwner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
      const uniVault = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
      const wfId = `0x${'1'.repeat(64)}` as Hex;
      const runId = `0x${'2'.repeat(64)}` as Hex;
      const programHash = `0x${'3'.repeat(64)}` as Hex;
      const txHash = `0x${'4'.repeat(64)}` as Hex;

      await db.query(
        `insert into telegram_accounts (automation_chain, agent, chat_id, profile, connection_id, enabled, action_alerts, funding_alerts, default_mode, enabled_since, defaults_since, action_since, funding_since)
         values ($1, $2, '77777', 'MainnetUser', gen_random_uuid(), true, true, true, 'all', '-infinity', '-infinity', '-infinity', '-infinity')`,
        [REACTIVE_MAINNET_CHAIN_ID, mainnetAgent],
      );
      await db.query(
        `insert into workflow_v2_accounts (deployment, chain, address, owner, agent) values
          ($1, $2, $4, $5, $4),
          ($1, $3, $6, $5, $4)`,
        [
          mainnetDeploymentKey,
          REACTIVE_MAINNET_CHAIN_ID,
          UNICHAIN_MAINNET_CHAIN_ID,
          mainnetAgent,
          mainnetOwner,
          uniVault,
        ],
      );
      await db.query(
        `insert into workflow_v2_activations values ($1, $2, $3, $4, '1', $5, 'Mainnet DCA')`,
        [mainnetDeploymentKey, UNICHAIN_MAINNET_CHAIN_ID, mainnetAgent, wfId, programHash],
      );
      await db.query(
        `insert into workflow_v2_cursors values ($1, $2, 100, now()), ($1, $3, 100, now())`,
        [mainnetDeploymentKey, REACTIVE_MAINNET_CHAIN_ID, UNICHAIN_MAINNET_CHAIN_ID],
      );
      await db.query(
        `insert into workflow_v2_runs values ($1, $2, $3, $4, $5, $6, '1', $2, $7, '0', $7, 5, extract(epoch from now())::bigint - 180)`,
        [
          mainnetDeploymentKey,
          UNICHAIN_MAINNET_CHAIN_ID,
          runId,
          mainnetAgent,
          wfId,
          programHash,
          txHash,
        ],
      );
      await db.query(`select telegram_process_unfinished($1, $2, $3)`, [
        mainnetDeploymentKey,
        UNICHAIN_MAINNET_CHAIN_ID,
        'https://app.example.com',
      ]);
      const deliveries = (
        await db.query<{ message: string }>(
          `select message from telegram_deliveries where alert_kind = 'unfinished'`,
        )
      ).rows;
      expect(deliveries[0]?.message).toContain(
        `https://app.example.com/runs/${runId}?network=mainnet`,
      );
    } finally {
      await db.close();
    }

    const rpcs = {
      lasna: { getBlockNumber: vi.fn(async () => 1n) } as unknown as PublicClient,
      unichain: { getBlockNumber: vi.fn(async () => 1n) } as unknown as PublicClient,
      reactiveMainnet: { getBlockNumber: vi.fn(async () => 1n) } as unknown as PublicClient,
      unichainMainnet: { getBlockNumber: vi.fn(async () => 1n) } as unknown as PublicClient,
    };
    const health = await buildRpcHealthChecks(rpcs, undefined, MAINNET_DEPLOYMENT);
    expect(health.map((entry) => entry.chain_id)).toEqual([
      REACTIVE_MAINNET_CHAIN_ID,
      UNICHAIN_MAINNET_CHAIN_ID,
    ]);
    expect(rpcs.lasna.getBlockNumber).not.toHaveBeenCalled();
    expect(rpcs.unichain.getBlockNumber).not.toHaveBeenCalled();

    const fundingMessages: string[] = [];
    const fundingAlerts = new TelegramFundingAlerts(
      {
        rpc: vi.fn(async (_name, params: Record<string, unknown>) => {
          if (typeof params.p_message === 'string') fundingMessages.push(params.p_message);
          return null;
        }) as never,
      },
      {
        lasna: {} as PublicClient,
        unichain: {} as PublicClient,
        reactiveMainnet: {
          getBlock: vi.fn(async () => ({ number: 10n, timestamp: 9999999999n })),
          readContract: vi.fn(async () => 0n),
        } as unknown as PublicClient,
        unichainMainnet: {
          getBlock: vi.fn(async () => ({ number: 10n, timestamp: 9999999999n })),
          readContract: vi.fn(async () => 0n),
        } as unknown as PublicClient,
      },
      REACTIVE_FACTORY,
      { [UNICHAIN_MAINNET_CHAIN_ID]: UNICHAIN_FACTORY },
      'https://app.example.com',
      REACTIVE_MAINNET_CHAIN_ID,
    );
    const currentFundingMsg = await fundingAlerts.currentMessage({
      kind: 'funding',
      chain: UNICHAIN_MAINNET_CHAIN_ID,
      beneficiary: '0xcccccccccccccccccccccccccccccccccccccccc',
      state: 'empty',
      block: '5',
    });
    expect(currentFundingMsg).toContain(
      `https://app.example.com/account?credit=execution&chain=${UNICHAIN_MAINNET_CHAIN_ID}&network=mainnet`,
    );

    const testnetFundingAlerts = new TelegramFundingAlerts(
      { rpc: vi.fn(async () => null) as never },
      {
        lasna: {
          getBlock: vi.fn(async () => ({ number: 10n, timestamp: 9999999999n })),
          readContract: vi.fn(async () => 0n),
        } as unknown as PublicClient,
        unichain: {
          getBlock: vi.fn(async () => ({ number: 10n, timestamp: 9999999999n })),
          readContract: vi.fn(async () => 0n),
        } as unknown as PublicClient,
        base: {
          getBlock: vi.fn(async () => ({ number: 10n, timestamp: 9999999999n })),
          readContract: vi.fn(async () => 0n),
        } as unknown as PublicClient,
      },
      REACTIVE_FACTORY,
      {
        [UNICHAIN_SEPOLIA_CHAIN_ID]: UNICHAIN_FACTORY,
        [BASE_SEPOLIA_CHAIN_ID]: BASE_FACTORY,
      },
      'https://app.example.com',
      LASNA_CHAIN_ID,
    );
    const baseSepoliaMsg = await testnetFundingAlerts.currentMessage({
      kind: 'funding',
      chain: BASE_SEPOLIA_CHAIN_ID,
      beneficiary: '0xdddddddddddddddddddddddddddddddddddddddd',
      state: 'empty',
      block: '5',
    });
    expect(baseSepoliaMsg).toContain(
      `https://app.example.com/account?credit=execution&chain=${BASE_SEPOLIA_CHAIN_ID}`,
    );
    expect(baseSepoliaMsg).not.toContain('network=mainnet');

    const lasnaMsg = await testnetFundingAlerts.currentMessage({
      kind: 'funding',
      chain: LASNA_CHAIN_ID,
      beneficiary: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      state: 'empty',
      block: '5',
    });
    expect(lasnaMsg).toContain('https://app.example.com/account?credit=watching');
    expect(lasnaMsg).not.toContain('chain=');
  });
});
