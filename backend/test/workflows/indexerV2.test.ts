import {
  BASE_SEPOLIA_CHAIN_ID,
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowDeploymentKey,
  type WorkflowV2Deployment,
  type WorkflowV2MainnetDeployment,
} from '@rulebook/shared';
import { createClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { keccak256, type Address, type Hex, type PublicClient } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowV2Indexer } from '../../src/workflows/indexerV2.js';

const LASNA_FACTORY = '0x1111111111111111111111111111111111111111' as Address;
const UNICHAIN_FACTORY = '0x2222222222222222222222222222222222222222' as Address;
const BASE_FACTORY = '0x3333333333333333333333333333333333333333' as Address;

const DEPLOYMENT: WorkflowV2Deployment = {
  lasna: { factory: LASNA_FACTORY, startBlock: 100 },
  unichain: { factory: UNICHAIN_FACTORY, startBlock: 200 },
  base: { factory: BASE_FACTORY, startBlock: 300 },
};

const silentLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as FastifyBaseLogger;

function addr(index: number): Address {
  return `0x${index.toString(16).padStart(40, '0')}` as Address;
}

function hash(byte: string): Hex {
  return `0x${byte.repeat(64)}` as Hex;
}

interface FakeDbOptions {
  cursors?: Record<number, number>;
  accounts?: Record<number, Address[]>;
}

function createFakeDb(options: FakeDbOptions = {}) {
  const upserts: Array<{ table: string; rows: unknown[] }> = [];
  const updates: Array<{
    table: string;
    body: Record<string, unknown>;
    filters: Record<string, string>;
  }> = [];
  const accountPages: Array<{ chain: number; offset: number; limit: number }> = [];

  const db = createClient('https://database.example', 'fixture-key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split('/').pop() ?? '';
        const method = (init?.method ?? 'GET').toUpperCase();

        if (method === 'POST') {
          const rawBody = typeof init?.body === 'string' ? init.body : '[]';
          const parsed = JSON.parse(rawBody);
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          upserts.push({ table, rows });
          return Response.json(rows, { status: 201 });
        }

        if (method === 'PATCH') {
          const rawBody = typeof init?.body === 'string' ? init.body : '{}';
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const filters: Record<string, string> = {};
          url.searchParams.forEach((value, key) => {
            filters[key] = value;
          });
          updates.push({ table, body, filters });
          return Response.json([]);
        }

        if (table === 'workflow_v2_cursors') {
          const chainParam = url.searchParams.get('chain') ?? '';
          const chain = Number(chainParam.replace(/^eq\./, ''));
          const block = options.cursors?.[chain];
          return Response.json(block === undefined ? null : { block_number: block });
        }

        if (table === 'workflow_v2_accounts') {
          const chainParam = url.searchParams.get('chain') ?? '';
          const chain = Number(chainParam.replace(/^eq\./, ''));
          const offset = Number(url.searchParams.get('offset') ?? '0');
          const limit = Number(url.searchParams.get('limit') ?? '1000');
          accountPages.push({ chain, offset, limit });
          const all = options.accounts?.[chain] ?? [];
          const slice = all.slice(offset, offset + limit).map((address) => ({ address }));
          return Response.json(slice);
        }

        return Response.json([]);
      },
    },
  });

  return { db, upserts, updates, accountPages };
}

interface GetLogsCall {
  address?: Address | Address[];
  fromBlock?: bigint;
  toBlock?: bigint;
  eventNames: string[];
}

function makeClient(
  headBlock: bigint,
  handler: (call: GetLogsCall) => unknown[],
): { client: PublicClient; calls: GetLogsCall[] } {
  const calls: GetLogsCall[] = [];
  const client = {
    getBlockNumber: vi.fn(async () => headBlock),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      timestamp: 1_700_000_000n + blockNumber,
    })),
    getLogs: vi.fn(
      async (params: {
        address?: Address | Address[];
        fromBlock?: bigint;
        toBlock?: bigint;
        events?: readonly { name?: string }[];
      }) => {
        const call: GetLogsCall = {
          address: params.address,
          fromBlock: params.fromBlock,
          toBlock: params.toBlock,
          eventNames: (params.events ?? []).map((item) => item.name ?? ''),
        };
        calls.push(call);
        return handler(call);
      },
    ),
  } as unknown as PublicClient;

  return { client, calls };
}

describe('WorkflowV2Indexer', () => {
  it('never calls getLogs without an address and skips event scans when no accounts exist', async () => {
    const { db, upserts } = createFakeDb();
    const lasna = makeClient(200n, () => []);
    const unichain = makeClient(300n, () => []);
    const base = makeClient(400n, () => []);

    const indexer = new WorkflowV2Indexer(
      db,
      { lasna: lasna.client, unichain: unichain.client, base: base.client },
      DEPLOYMENT,
      silentLogger,
    );

    await indexer.syncOnce();

    for (const calls of [lasna.calls, unichain.calls, base.calls]) {
      expect(calls).toHaveLength(1);
      expect(calls[0]?.address).toBeDefined();
    }
    expect(lasna.calls[0]?.address).toBe(LASNA_FACTORY);
    expect(unichain.calls[0]?.address).toBe(UNICHAIN_FACTORY);
    expect(base.calls[0]?.address).toBe(BASE_FACTORY);
    const cursorUpserts = upserts
      .filter((item) => item.table === 'workflow_v2_cursors')
      .flatMap((item) => item.rows as Array<{ deployment: string }>);
    expect(cursorUpserts).toHaveLength(3);
    expect(
      cursorUpserts.every(
        (row) => row.deployment === workflowDeploymentKey(LASNA_CHAIN_ID, LASNA_FACTORY),
      ),
    ).toBe(true);
  });

  it('namespaces deployment keys by automation chain so identical factory addresses never collide', async () => {
    const sharedFactory = addr(777);
    const testnetConfig: WorkflowV2Deployment = {
      lasna: { factory: sharedFactory, startBlock: 100 },
      unichain: { factory: UNICHAIN_FACTORY, startBlock: 200 },
    };
    const mainnetConfig: WorkflowV2MainnetDeployment = {
      reactive: { factory: sharedFactory, startBlock: 100 },
      unichain: { factory: UNICHAIN_FACTORY, startBlock: 200 },
    };
    const { db, upserts } = createFakeDb();
    const testnetIndexer = new WorkflowV2Indexer(
      db,
      {
        lasna: makeClient(150n, () => []).client,
        unichain: makeClient(250n, () => []).client,
      },
      testnetConfig,
      silentLogger,
    );
    const mainnetIndexer = new WorkflowV2Indexer(
      db,
      {
        lasna: makeClient(150n, () => []).client,
        unichain: makeClient(250n, () => []).client,
        reactiveMainnet: makeClient(150n, () => []).client,
        unichainMainnet: makeClient(250n, () => []).client,
      },
      mainnetConfig,
      silentLogger,
    );

    await Promise.all([testnetIndexer.syncOnce(), mainnetIndexer.syncOnce()]);

    const cursorRows = upserts
      .filter((item) => item.table === 'workflow_v2_cursors')
      .flatMap((item) => item.rows as Array<{ deployment: string; chain: number }>);
    expect(cursorRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deployment: workflowDeploymentKey(LASNA_CHAIN_ID, sharedFactory),
          chain: LASNA_CHAIN_ID,
        }),
        expect.objectContaining({
          deployment: workflowDeploymentKey(LASNA_CHAIN_ID, sharedFactory),
          chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        }),
        expect.objectContaining({
          deployment: workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, sharedFactory),
          chain: REACTIVE_MAINNET_CHAIN_ID,
        }),
        expect.objectContaining({
          deployment: workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, sharedFactory),
          chain: UNICHAIN_MAINNET_CHAIN_ID,
        }),
      ]),
    );
  });

  it('includes newly created accounts in the same-range event scan and batches over 50 addresses', async () => {
    const existingVaults = Array.from({ length: 54 }, (_, index) => addr(index + 1));
    const newVault = addr(99);
    const owner = addr(200);
    const agent = addr(201);
    const workflowId = hash('1');
    const runIdA = hash('2');
    const runIdB = hash('3');
    const txA = hash('4');
    const txB = hash('5');

    const { db, upserts } = createFakeDb({
      cursors: {
        [LASNA_CHAIN_ID]: 200,
        [UNICHAIN_SEPOLIA_CHAIN_ID]: 205,
        [BASE_SEPOLIA_CHAIN_ID]: 350,
      },
      accounts: {
        [UNICHAIN_SEPOLIA_CHAIN_ID]: existingVaults,
      },
    });

    const lasna = makeClient(200n, () => []);
    const base = makeClient(350n, () => []);
    const unichain = makeClient(250n, (call) => {
      if (call.address === UNICHAIN_FACTORY) {
        return [
          {
            eventName: 'VaultCreated',
            address: UNICHAIN_FACTORY,
            blockNumber: 206n,
            logIndex: 0,
            args: { owner, agent, vault: newVault },
          },
        ];
      }
      const batch = Array.isArray(call.address) ? call.address : [];
      const found = [];
      if (batch.includes(existingVaults[0]!)) {
        found.push({
          eventName: 'Outcome',
          address: existingVaults[0]!,
          blockNumber: 208n,
          logIndex: 1,
          transactionHash: txB,
          args: {
            workflow: workflowId,
            epoch: 1n,
            runId: runIdB,
            status: 1,
            path: 2,
            reason: '0x00000000',
          },
        });
      }
      if (batch.includes(newVault)) {
        found.push({
          eventName: 'Outcome',
          address: newVault,
          blockNumber: 207n,
          logIndex: 0,
          transactionHash: txA,
          args: {
            workflow: workflowId,
            epoch: 1n,
            runId: runIdA,
            status: 1,
            path: 1,
            reason: '0x00000000',
          },
        });
      }
      return found;
    });

    const indexer = new WorkflowV2Indexer(
      db,
      { lasna: lasna.client, unichain: unichain.client, base: base.client },
      DEPLOYMENT,
      silentLogger,
    );

    await indexer.syncOnce();

    expect(unichain.calls).toHaveLength(3);
    expect(unichain.calls[0]?.address).toBe(UNICHAIN_FACTORY);
    expect(unichain.calls[1]?.address).toHaveLength(50);
    expect(unichain.calls[2]?.address).toHaveLength(5);
    expect(unichain.calls.slice(1).flatMap((call) => call.address)).toContain(newVault);

    const outcomeUpsert = upserts.find((item) => item.table === 'workflow_v2_outcomes');
    expect(outcomeUpsert?.rows).toHaveLength(2);
    expect((outcomeUpsert?.rows as Array<{ run_id: string }>).map((row) => row.run_id)).toEqual([
      runIdA,
      runIdB,
    ]);
  });

  it('paginates known accounts beyond 1000 rows without dropping addresses', async () => {
    const pagedVaults = Array.from({ length: 1005 }, (_, index) => addr(index + 1));
    const { db, accountPages } = createFakeDb({
      cursors: {
        [LASNA_CHAIN_ID]: 200,
        [UNICHAIN_SEPOLIA_CHAIN_ID]: 205,
        [BASE_SEPOLIA_CHAIN_ID]: 350,
      },
      accounts: {
        [UNICHAIN_SEPOLIA_CHAIN_ID]: pagedVaults,
      },
    });

    const lasna = makeClient(200n, () => []);
    const unichain = makeClient(250n, () => []);
    const base = makeClient(350n, () => []);

    const indexer = new WorkflowV2Indexer(
      db,
      { lasna: lasna.client, unichain: unichain.client, base: base.client },
      DEPLOYMENT,
      silentLogger,
    );

    await indexer.syncOnce();

    expect(accountPages.filter((page) => page.chain === UNICHAIN_SEPOLIA_CHAIN_ID)).toEqual([
      { chain: UNICHAIN_SEPOLIA_CHAIN_ID, offset: 0, limit: 1000 },
      { chain: UNICHAIN_SEPOLIA_CHAIN_ID, offset: 1000, limit: 1000 },
    ]);
    // 1 factory scan + ceil(1005 / 50) = 21 outcome batch scans
    expect(unichain.calls).toHaveLength(22);
    for (const call of unichain.calls) {
      expect(call.address).toBeDefined();
      if (Array.isArray(call.address)) {
        expect(call.address.length).toBeLessThanOrEqual(50);
      }
    }
  });

  it('halves block ranges on RPC log errors and rewinds cursor when a reorg is detected', async () => {
    const deletes: string[] = [];
    const upserts: Array<{ table: string; rows: unknown[] }> = [];
    const staleHash = hash('a');
    const canonicalHash = hash('b');
    const db = createClient('https://database.example', 'fixture-key', {
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const table = url.pathname.split('/').pop() ?? '';
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method === 'DELETE') {
            deletes.push(table);
            return Response.json([]);
          }
          if (method === 'POST') {
            const parsed = JSON.parse(typeof init?.body === 'string' ? init.body : '[]');
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            upserts.push({ table, rows });
            return Response.json(rows, { status: 201 });
          }
          if (table === 'workflow_v2_cursors') {
            const chain = Number((url.searchParams.get('chain') ?? '').replace(/^eq\./, ''));
            if (chain === UNICHAIN_SEPOLIA_CHAIN_ID) {
              return Response.json({ block_number: 250, block_hash: staleHash });
            }
            return Response.json({ block_number: 200, block_hash: canonicalHash });
          }
          return Response.json([]);
        },
      },
    });

    const unichainCalls: Array<{ from?: bigint; to?: bigint }> = [];
    const lasna = {
      getBlockNumber: vi.fn(async () => 250n),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
        timestamp: 1_700_000_000n + blockNumber,
        hash: canonicalHash,
      })),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 20n) {
          throw new Error('Log response size exceeded');
        }
        return [];
      }),
    } as unknown as PublicClient;

    const unichain = {
      getBlockNumber: vi.fn(async () => 270n),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
        timestamp: 1_700_000_000n + blockNumber,
        hash: blockNumber === 250n ? canonicalHash : staleHash,
      })),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        unichainCalls.push({ from: fromBlock, to: toBlock });
        return [];
      }),
    } as unknown as PublicClient;

    const indexer = new WorkflowV2Indexer(
      db,
      { lasna, unichain },
      { lasna: DEPLOYMENT.lasna, unichain: DEPLOYMENT.unichain },
      silentLogger,
    );

    await indexer.syncOnce();

    expect(deletes).toContain('workflow_v2_outcomes');
    expect(deletes).not.toContain('workflow_v2_market_listings');
    expect(deletes).not.toContain('workflow_v2_runs');
    const rewoundCursor = upserts
      .filter((item) => item.table === 'workflow_v2_cursors')
      .flatMap(
        (item) =>
          item.rows as Array<{ chain: number; block_number: number; block_hash: string | null }>,
      )
      .find((row) => row.chain === UNICHAIN_SEPOLIA_CHAIN_ID);
    expect(rewoundCursor).toMatchObject({
      chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      block_number: 226,
      block_hash: null,
    });
    const lasnaCursor = upserts
      .filter((item) => item.table === 'workflow_v2_cursors')
      .flatMap(
        (item) =>
          item.rows as Array<{ chain: number; block_number: number; block_hash: string | null }>,
      )
      .find((row) => row.chain === LASNA_CHAIN_ID);
    expect(lasnaCursor?.block_number).toBeLessThanOrEqual(220);
  });

  it('rewinds runs and market listings without outcomes on an automation-chain reorg', async () => {
    const deletes: string[] = [];
    const staleHash = hash('c');
    const canonicalHash = hash('d');
    const db = createClient('https://database.example', 'fixture-key', {
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const table = url.pathname.split('/').pop() ?? '';
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method === 'DELETE') {
            deletes.push(table);
            return Response.json([]);
          }
          if (method === 'POST') {
            const parsed = JSON.parse(typeof init?.body === 'string' ? init.body : '[]');
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            return Response.json(rows, { status: 201 });
          }
          if (table === 'workflow_v2_cursors') {
            const chain = Number((url.searchParams.get('chain') ?? '').replace(/^eq\./, ''));
            return Response.json(
              chain === LASNA_CHAIN_ID
                ? { block_number: 200, block_hash: staleHash }
                : { block_number: 200, block_hash: canonicalHash },
            );
          }
          return Response.json([]);
        },
      },
    });

    const lasna = {
      getBlockNumber: vi.fn(async () => 230n),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
        timestamp: 1_700_000_000n + blockNumber,
        hash: canonicalHash,
      })),
      getLogs: vi.fn(async () => []),
    } as unknown as PublicClient;

    const unichain = {
      getBlockNumber: vi.fn(async () => 220n),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
        timestamp: 1_700_000_000n + blockNumber,
        hash: canonicalHash,
      })),
      getLogs: vi.fn(async () => []),
    } as unknown as PublicClient;

    const indexer = new WorkflowV2Indexer(
      db,
      { lasna, unichain },
      { lasna: DEPLOYMENT.lasna, unichain: DEPLOYMENT.unichain },
      silentLogger,
    );

    await indexer.syncOnce();

    expect(deletes).toEqual(
      expect.arrayContaining(['workflow_v2_runs', 'workflow_v2_market_listings']),
    );
    expect(deletes).not.toContain('workflow_v2_outcomes');
  });

  it('decodes origin_chain and trigger when indexing Published marketplace listings', async () => {
    const owner = addr(20);
    const agent = addr(21);
    const workflow = hash('9');
    const program = encodeWorkflowV2(
      createWorkflowV2Recipe(
        'buy-the-dip',
        {
          intervalSeconds: '3600',
          dipPercent: '5',
          buyUsdc: '10',
          slippagePercent: '1',
        },
        { chain: BASE_SEPOLIA_CHAIN_ID, originChain: UNICHAIN_SEPOLIA_CHAIN_ID },
      ),
    );
    const programHash = keccak256(program);
    const { db, upserts } = createFakeDb({
      cursors: {
        [LASNA_CHAIN_ID]: 100,
        [UNICHAIN_SEPOLIA_CHAIN_ID]: 250,
        [BASE_SEPOLIA_CHAIN_ID]: 350,
      },
    });
    const lasna = makeClient(130n, (call) => {
      if (call.address === LASNA_FACTORY) {
        return [
          {
            eventName: 'Published',
            address: LASNA_FACTORY,
            blockNumber: 105n,
            logIndex: 0,
            args: {
              listing: 7n,
              owner,
              agent,
              workflow,
              programHash,
              chain: BASE_SEPOLIA_CHAIN_ID,
              title: 'Dip buyer',
              description: 'Buys WETH on Base when Unichain dips',
            },
          },
        ];
      }
      return [];
    });
    (lasna.client as unknown as { readContract: ReturnType<typeof vi.fn> }).readContract = vi.fn(
      async () => program,
    );

    const indexer = new WorkflowV2Indexer(
      db,
      {
        lasna: lasna.client,
        unichain: makeClient(250n, () => []).client,
        base: makeClient(350n, () => []).client,
      },
      DEPLOYMENT,
      silentLogger,
    );

    await indexer.syncOnce();

    const listingRows = upserts
      .filter((item) => item.table === 'workflow_v2_market_listings')
      .flatMap((item) => item.rows as Array<Record<string, unknown>>);
    expect(listingRows).toHaveLength(1);
    expect(listingRows[0]).toMatchObject({
      id: '7',
      chain: BASE_SEPOLIA_CHAIN_ID,
      origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      trigger: 1,
      title: 'Dip buyer',
    });
  });

  it('updates workflow_v2_accounts.agent when a known Vault emits AgentRebound', async () => {
    const vault = addr(55);
    const oldAgent = addr(56);
    const nextAgent = addr(57);
    const { db, upserts, updates } = createFakeDb({
      cursors: {
        [LASNA_CHAIN_ID]: 100,
        [UNICHAIN_SEPOLIA_CHAIN_ID]: 205,
        [BASE_SEPOLIA_CHAIN_ID]: 350,
      },
      accounts: {
        [UNICHAIN_SEPOLIA_CHAIN_ID]: [vault],
      },
    });
    const unichain = makeClient(250n, (call) => {
      if (Array.isArray(call.address) && call.address.includes(vault)) {
        return [
          {
            eventName: 'AgentRebound',
            address: vault,
            blockNumber: 206n,
            logIndex: 0,
            transactionHash: hash('e'),
            args: {
              previousAgent: oldAgent,
              nextAgent,
            },
          },
        ];
      }
      return [];
    });

    const indexer = new WorkflowV2Indexer(
      db,
      {
        lasna: makeClient(100n, () => []).client,
        unichain: unichain.client,
        base: makeClient(350n, () => []).client,
      },
      DEPLOYMENT,
      silentLogger,
    );

    await indexer.syncOnce();

    expect(updates).toEqual([
      {
        table: 'workflow_v2_accounts',
        body: { agent: nextAgent.toLowerCase() },
        filters: {
          deployment: `eq.${workflowDeploymentKey(LASNA_CHAIN_ID, LASNA_FACTORY)}`,
          chain: `eq.${UNICHAIN_SEPOLIA_CHAIN_ID}`,
          address: `eq.${vault.toLowerCase()}`,
        },
      },
    ]);
    expect(upserts.filter((item) => item.table === 'workflow_v2_outcomes')).toHaveLength(0);
  });
});
