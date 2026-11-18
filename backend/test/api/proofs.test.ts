import { proofSchema, type CallbackRecord } from '@rulebook/shared';
import { toFunctionSelector } from 'viem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChainProof, ProofSource } from '../../src/chain/proofSource.js';
import type { AppConfig } from '../../src/config.js';
import { createRepositories } from '../../src/db/repositories/index.js';
import { InMemoryStore } from '../../src/db/store.js';
import type { ServerDeps } from '../../src/deps.js';
import { CursorStore } from '../../src/indexer/cursors.js';
import { buildServer } from '../../src/server.js';

const HASH = `0x${'1'.repeat(64)}` as const;
const ORIGIN_HASH = `0x${'2'.repeat(64)}` as const;
const DESTINATION_HASH = `0x${'3'.repeat(64)}` as const;
const AGENT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;

const config: AppConfig = {
  PORT: 8787,
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  LASNA_RPC_URL: 'https://lasna-rpc.rnk.dev/',
  UNICHAIN_RPC_URL: 'https://sepolia.unichain.org',
  INDEXER_ENABLED: false,
  INDEXER_START_BLOCK_LASNA: 0,
  INDEXER_START_BLOCK_UNICHAIN: 0,
  SPONSOR_GAS_TOP_UP_WEI: '50000000000000000',
  SPONSOR_RESERVE_TARGET_WEI: '200000000000000000',
  STARTER_FUNDS_USDC: '10000000',
  STARTER_FUNDS_WETH: '10000000000000000',
  ONBOARDING_RATE_LIMIT_PER_MINUTE: 3,
  ONBOARDING_DAILY_CAP: 100,
  corsOrigins: ['http://localhost:5173'],
};

function callback(overrides: Partial<CallbackRecord> = {}): CallbackRecord {
  return {
    block_number: 100,
    reacting_contract: AGENT,
    callback_index: 0,
    destination_chain_id: 1301,
    destination_tx_hash: DESTINATION_HASH,
    error_data: '0x',
    ...overrides,
  };
}

function chainProof(overrides: Partial<ChainProof> = {}): ChainProof {
  const record = callback();
  return {
    reactive_tx: HASH,
    origin: {
      chain_id: 1301,
      tx_hash: ORIGIN_HASH,
      log_index: 7,
      block_number: 10,
      timestamp: '2026-11-16T10:00:00.000Z',
    },
    automation: {
      chain_id: 5_318_007,
      tx_hash: HASH,
      block_number: 100,
      timestamp: '2026-11-16T10:00:02.000Z',
    },
    destinations: [
      {
        chain_id: 1301,
        tx_hash: DESTINATION_HASH,
        block_number: 11,
        timestamp: '2026-11-16T10:00:05.000Z',
        callback: record,
      },
    ],
    latency_ms: 5_000,
    callbacks: [record],
    ...overrides,
  };
}

function makeHarness(proofSource?: ProofSource) {
  const store = new InMemoryStore();
  const repositories = createRepositories(store);
  const deps: ServerDeps = {
    config,
    repositories,
    cursors: new CursorStore(store),
    databaseReachable: async () => true,
    rpcHealth: async () => [],
    accountChain: { agentLink: async () => null, vaultOwner: async () => null },
    onboardingLimiter: { allow: () => true },
    ...(proofSource ? { proofSource } : {}),
  };
  return { app: buildServer(deps, { logger: false }).app, repositories, deps };
}

async function seedCache(repositories: ReturnType<typeof createRepositories>): Promise<void> {
  await repositories.callbacks.upsert([
    {
      reactive_tx_hash: HASH,
      callback_index: 0,
      reactive_contract: AGENT,
      destination_chain_id: '1301',
      destination_tx_hash: DESTINATION_HASH,
      error_data: null,
      block_number: 100,
      recorded_at: new Date().toISOString(),
    },
  ]);
  await repositories.ruleEvents.upsert({
    chain_id: 5_318_007,
    tx_hash: HASH,
    log_index: 4,
    agent: AGENT,
    rule_id: '0',
    kind: 'evaluated_fired',
    block_time: '2026-11-16T10:00:02.000Z',
    origin_chain_id: 1301,
    origin_tx: ORIGIN_HASH,
    origin_log_index: 7,
    fired: true,
  });
}

describe('GET /v1/proofs/:reactiveTxHash', () => {
  let proofSource: ProofSource;

  beforeEach(() => {
    proofSource = { read: async () => chainProof() };
  });

  it('reads the chain first and returns three labelled rows with one latency', async () => {
    const { app, repositories } = makeHarness(proofSource);

    const response = await app.inject({ method: 'GET', url: `/v1/proofs/${HASH}` });

    expect(response.statusCode).toBe(200);
    const proof = proofSchema.parse(response.json());
    expect(proof.source).toBe('chain');
    expect(proof.cache_age_seconds).toBeNull();
    expect(proof.latency_ms).toBe(5_000);
    expect(proof.rows.map((row) => row.role)).toEqual(['origin', 'automation', 'destination']);
    expect(proof.rows[0]?.explorer_url).toContain('sepolia.uniscan.xyz');
    expect(proof.rows[1]?.explorer_url).toContain('reactscan.net');
    expect(proof.rows[2]?.tx_hash).toBe(DESTINATION_HASH);

    // A successful chain read refreshes the cache for the next outage.
    expect(await repositories.callbacks.listForTx(HASH)).toHaveLength(1);
    await app.close();
  });

  it('serves the cache with its age when the chain read fails', async () => {
    proofSource = {
      read: async () => {
        throw new Error('lasna RPC unavailable');
      },
    };
    const { app, repositories } = makeHarness(proofSource);
    await seedCache(repositories);

    const response = await app.inject({ method: 'GET', url: `/v1/proofs/${HASH}` });

    expect(response.statusCode).toBe(200);
    const proof = proofSchema.parse(response.json());
    expect(proof.source).toBe('cache');
    expect(proof.cache_age_seconds).toBeTypeOf('number');
    expect(proof.latency_ms).toBeNull();
    expect(proof.rows.map((row) => row.role)).toEqual(['origin', 'automation', 'destination']);
    await app.close();
  });

  it('verifies the follower callback on chain before grouping it with the leader', async () => {
    const followerReactive = `0x${'4'.repeat(64)}` as const;
    const followerDestination = `0x${'5'.repeat(64)}` as const;
    const record = callback({
      destination_tx_hash: followerDestination,
      error_data: toFunctionSelector('SlippageExceeded(uint256,uint256)'),
    });
    const { app, repositories } = makeHarness({
      read: async (hash) =>
        hash === HASH
          ? chainProof({ leaderTransactions: [DESTINATION_HASH] })
          : chainProof({
              reactive_tx: followerReactive,
              mirrorRequests: [{ leaderTx: DESTINATION_HASH, agent: AGENT }],
              destinations: [{ chain_id: 1301, tx_hash: followerDestination, callback: record }],
              callbacks: [record],
            }),
    });
    await repositories.ruleEvents.upsert({
      chain_id: 5_318_007,
      tx_hash: followerReactive,
      log_index: 0,
      agent: AGENT,
      rule_id: '0',
      kind: 'mirror_callback_requested',
      origin_tx: DESTINATION_HASH,
      block_time: '2026-11-18T00:00:00.000Z',
    });
    const response = await app.inject(`/v1/proofs/${HASH}?include=mirrors`);
    expect(response.statusCode).toBe(200);
    const destinations = proofSchema
      .parse(response.json())
      .rows.filter((row) => row.role === 'destination');
    expect(destinations.map((row) => [row.execution_role, row.tx_hash])).toEqual([
      ['leader', DESTINATION_HASH],
      ['follower', followerDestination],
    ]);
    expect(destinations[1]?.error?.selector).toBe(record.error_data);
    await app.close();
  });

  it('returns 503 when both the chain and the cache are unavailable', async () => {
    proofSource = {
      read: async () => {
        throw new Error('lasna RPC unavailable');
      },
    };
    const { app } = makeHarness(proofSource);

    const response = await app.inject({ method: 'GET', url: `/v1/proofs/${HASH}` });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('proof_unavailable');
    await app.close();
  });

  it('returns 404 rather than a fake success when getCallbacks is empty', async () => {
    proofSource = { read: async () => null };
    const { app, repositories } = makeHarness(proofSource);
    await seedCache(repositories);

    const response = await app.inject({ method: 'GET', url: `/v1/proofs/${HASH}` });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
    await app.close();
  });

  it('surfaces a refused callback with its selector and a plain-language reason', async () => {
    const selector = toFunctionSelector('ConditionNotMet()');
    const refused = callback({ error_data: `${selector}${'0'.repeat(64)}` });
    proofSource = {
      read: async () =>
        chainProof({
          destinations: [
            {
              chain_id: 1301,
              tx_hash: DESTINATION_HASH,
              callback: refused,
            },
          ],
          callbacks: [refused],
          latency_ms: null,
        }),
    };
    const { app } = makeHarness(proofSource);

    const response = await app.inject({ method: 'GET', url: `/v1/proofs/${HASH}` });
    const body = response.json();
    const proof = proofSchema.parse(body);

    expect(response.statusCode).toBe(200);
    expect(proof.rows[2]?.error?.selector).toBe(selector);
    expect(proof.rows[2]?.error?.message).toContain(selector);
    expect(proof.rows[2]?.error?.human).toMatch(/condition no longer holds/i);
    expect(JSON.stringify(body)).not.toMatch(/success/i);
    await app.close();
  });
});
