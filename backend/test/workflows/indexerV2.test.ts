import {
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type WorkflowV2Deployment,
} from '@rulebook/shared';
import { createClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import type { Address, Hex, PublicClient } from 'viem';
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

  return { db, upserts, accountPages };
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
    expect(upserts.filter((item) => item.table === 'workflow_v2_cursors')).toHaveLength(3);
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
});
