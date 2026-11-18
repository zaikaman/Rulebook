import { leaderboardResponseSchema, listingsResponseSchema, type Listing } from '@rulebook/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../src/config.js';
import { createRepositories, type Repositories } from '../../src/db/repositories/index.js';
import { InMemoryStore } from '../../src/db/store.js';
import { CursorStore } from '../../src/indexer/cursors.js';
import { seedMarketplace } from '../../src/marketplace/seed.js';
import { buildServer } from '../../src/server.js';

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

const AUTHOR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function agent(index: number): string {
  return `0x${index.toString(16).padStart(40, '0')}`;
}

function makeDeps(repositories: Repositories) {
  const store = new InMemoryStore();
  return {
    config,
    repositories,
    cursors: new CursorStore(store),
    databaseReachable: async () => true,
    rpcHealth: async () => [
      { chain_id: 5_318_007, rpc_ok: true },
      { chain_id: 1301, rpc_ok: true },
    ],
    accountChain: { agentLink: async () => null, vaultOwner: async () => null },
    onboardingLimiter: { allow: () => true },
  };
}

async function addRule(
  repositories: Repositories,
  index: number,
  options: { template?: number; createdAt?: string; badge?: 'team' | 'community' } = {},
): Promise<{ agent: string; ruleId: string }> {
  const address = agent(index);
  const ruleId = String(index);
  const template = options.template ?? 1;
  await repositories.agents.upsert({
    address,
    owner: AUTHOR,
    factory: '0x0000000000000000000000000000000000000000',
    created_tx: `0x${'0'.repeat(64)}`,
    created_block: 1,
    rule_count: 1,
    chain_id: 5_318_007,
  });
  await repositories.rules.upsert({
    agent: address,
    rule_id: ruleId,
    template,
    chain_id: 1301,
    status: 'active',
    latched: false,
    pair: null,
    token_in: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
    token_out: '0x4200000000000000000000000000000000000006',
    amount_in: '10000000',
    threshold: '0',
    secondary: '604800',
    last_run_at: null,
    runs: 0,
    is_public: true,
  });
  await repositories.listings.upsert({
    chain_id: 5_318_007,
    listing_id: ruleId,
    agent: address,
    rule_id: ruleId,
    template,
    metadata_uri: `rulebook://listing/${index}`,
    is_public: true,
    author: AUTHOR,
    author_badge: options.badge ?? 'community',
    name: `Rule ${index}`,
    description: `Description ${index}`,
    params_hash: `0x${'a'.repeat(64)}`,
    created_at: options.createdAt ?? `2026-11-${String(index).padStart(2, '0')}T00:00:00.000Z`,
  });
  return { agent: address, ruleId };
}

async function addExecution(
  repositories: Repositories,
  target: { agent: string; ruleId: string },
  index: number,
  status: 'confirmed' | 'refused' = 'confirmed',
): Promise<void> {
  await repositories.executions.upsert({
    chain_id: 1301,
    tx_hash: `0x${index.toString(16).padStart(64, '0')}`,
    log_index: index,
    vault: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    agent: target.agent,
    owner: AUTHOR,
    rule_id: target.ruleId,
    kind: 'executed',
    token_in: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
    token_out: '0x4200000000000000000000000000000000000006',
    amount_in: '10000000',
    amount_out: '9900000',
    block_number: index,
    block_time: '2026-11-16T00:00:00.000Z',
    leader_tx: null,
    status,
  });
}

describe('GET /v1/marketplace', () => {
  let repositories: Repositories;

  beforeEach(() => {
    repositories = createRepositories(new InMemoryStore());
  });

  it('paginates with opaque cursors and never repeats a listing', async () => {
    for (let index = 0; index < 5; index += 1) await addRule(repositories, index);
    const { app } = buildServer(makeDeps(repositories), { logger: false });

    const first = await app.inject({ method: 'GET', url: '/v1/marketplace?limit=2' });
    const firstPage = listingsResponseSchema.parse(first.json());
    expect(firstPage.listings).toHaveLength(2);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const second = await app.inject({
      method: 'GET',
      url: `/v1/marketplace?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor ?? '')}`,
    });
    const secondPage = listingsResponseSchema.parse(second.json());
    expect(secondPage.listings).toHaveLength(2);
    expect(secondPage.next_cursor).toEqual(expect.any(String));

    const third = await app.inject({
      method: 'GET',
      url: `/v1/marketplace?limit=2&cursor=${encodeURIComponent(secondPage.next_cursor ?? '')}`,
    });
    const thirdPage = listingsResponseSchema.parse(third.json());
    expect(thirdPage.listings).toHaveLength(1);
    expect(thirdPage.next_cursor).toBeNull();

    const ids = [...firstPage.listings, ...secondPage.listings, ...thirdPage.listings].map(
      (listing) => `${listing.agent}:${listing.rule_id}`,
    );
    expect(new Set(ids).size).toBe(5);
    await app.close();
  });

  it('filters by template', async () => {
    await addRule(repositories, 0, { template: 1 });
    await addRule(repositories, 1, { template: 3 });
    await addRule(repositories, 2, { template: 1 });
    const { app } = buildServer(makeDeps(repositories), { logger: false });

    const response = await app.inject({ method: 'GET', url: '/v1/marketplace?template=1' });
    const parsed = listingsResponseSchema.parse(response.json());
    expect(parsed.listings).toHaveLength(2);
    expect(parsed.listings.every((listing) => listing.template === 1)).toBe(true);
    await app.close();
  });

  it('sorts by newest, runs, and success rate', async () => {
    const oldest = await addRule(repositories, 0, { createdAt: '2026-11-01T00:00:00.000Z' });
    const middle = await addRule(repositories, 1, { createdAt: '2026-11-02T00:00:00.000Z' });
    await addRule(repositories, 2, { createdAt: '2026-11-03T00:00:00.000Z' });
    // middle: 5 runs with one refusal (0.8); oldest: 2/2 (1.0); newest: 0 runs (0).
    for (let index = 0; index < 5; index += 1) {
      await addExecution(repositories, middle, index, index === 0 ? 'refused' : 'confirmed');
    }
    await addExecution(repositories, oldest, 10);
    await addExecution(repositories, oldest, 11);
    const { app } = buildServer(makeDeps(repositories), { logger: false });

    const byNewest = listingsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/marketplace?sort=newest' })).json(),
    ).listings;
    expect(byNewest.map((listing) => listing.rule_id.toString())).toEqual(['2', '1', '0']);

    const byRuns = listingsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/marketplace?sort=runs' })).json(),
    ).listings;
    expect(byRuns.map((listing) => listing.rule_id.toString())).toEqual(['1', '0', '2']);
    expect(byRuns[0]?.runs).toBe(5);

    const bySuccess = listingsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/marketplace?sort=success_rate' })).json(),
    ).listings;
    expect(bySuccess.map((listing) => listing.rule_id.toString())).toEqual(['0', '1', '2']);
    expect(bySuccess[0]?.success_rate).toBe(1);
    expect(bySuccess[1]?.success_rate).toBeCloseTo(0.8);
    await app.close();
  });

  it('always includes an author badge on every row', async () => {
    await addRule(repositories, 0, { badge: 'team' });
    await addRule(repositories, 1, { badge: 'community' });
    const { app } = buildServer(makeDeps(repositories), { logger: false });

    const parsed = listingsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/marketplace' })).json(),
    );
    expect(parsed.listings).toHaveLength(2);
    for (const listing of parsed.listings) {
      expect(['team', 'community']).toContain(listing.author_badge);
    }
    await app.close();
  });
});

describe('marketplace seed', () => {
  it('is never empty on first load and every seeded row is badged team', async () => {
    const repositories = createRepositories(new InMemoryStore());
    await seedMarketplace(repositories);
    // Seeding twice must not duplicate the catalog.
    await seedMarketplace(repositories);
    const { app } = buildServer(makeDeps(repositories), { logger: false });

    const parsed = listingsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/marketplace?limit=50' })).json(),
    );
    expect(parsed.listings.length).toBeGreaterThanOrEqual(3);
    expect(parsed.listings.every((listing: Listing) => listing.author_badge === 'team')).toBe(true);
    expect(parsed.listings.every((listing) => Boolean(listing.name))).toBe(true);
    await app.close();
  });
});

describe('GET /v1/leaderboard', () => {
  it('ranks by runs then success rate and keeps the badge visible', async () => {
    const repositories = createRepositories(new InMemoryStore());
    const busy = await addRule(repositories, 0, { badge: 'team' });
    const careful = await addRule(repositories, 1, { badge: 'community' });
    const idle = await addRule(repositories, 2, { badge: 'community' });

    for (let index = 0; index < 3; index += 1) await addExecution(repositories, busy, index);
    await addExecution(repositories, careful, 10);
    await addExecution(repositories, careful, 11, 'refused');
    await addExecution(repositories, idle, 20);

    const { app } = buildServer(makeDeps(repositories), { logger: false });
    const parsed = leaderboardResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/leaderboard' })).json(),
    );

    expect(parsed.rows.map((row) => row.agent)).toEqual([busy.agent, careful.agent, idle.agent]);
    expect(parsed.rows.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(parsed.rows[0]?.runs).toBe(3);
    expect(parsed.rows[1]?.success_rate).toBeCloseTo(0.5);
    expect(parsed.rows[0]?.author_badge).toBe('team');
    expect(parsed.rows[1]?.author_badge).toBe('community');
    await app.close();
  });
});
