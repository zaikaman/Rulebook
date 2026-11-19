import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  apiErrorSchema,
  chainsResponseSchema,
  executionsResponseSchema,
  healthSchema,
  listingsResponseSchema,
  ruleDetailResponseSchema,
  sponsorStatusSchema,
} from '@rulebook/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AppConfig } from '../../src/config.js';
import { createRepositories } from '../../src/db/repositories/index.js';
import { InMemoryStore } from '../../src/db/store.js';
import { CursorStore } from '../../src/indexer/cursors.js';
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
  corsOrigins: ['http://localhost:5173'],
};

const AGENT = '0x1111111111111111111111111111111111111111';

function makeDeps() {
  const store = new InMemoryStore();
  return {
    config,
    repositories: createRepositories(store),
    cursors: new CursorStore(store),
    databaseReachable: async () => true,
    rpcHealth: async () => [
      { chain_id: 5_318_007, rpc_ok: true },
      { chain_id: 1301, rpc_ok: true },
    ],
    accountChain: { agentLink: async () => null, vaultOwner: async () => null },
  };
}

function declaredRoutes(): string[] {
  const yaml = readFileSync(
    join(process.cwd(), '..', 'specs', '001-reactive-rule-builder', 'contracts', 'http-api.yaml'),
    'utf8',
  );
  const routes: string[] = [];
  let inPaths = false;
  let current = '';
  for (const line of yaml.split(/\r?\n/)) {
    if (line === 'paths:') {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    if (/^[a-zA-Z]/.test(line)) break;
    const path = line.match(/^ {2}(\/[^\s:]+):\s*$/);
    if (path?.[1]) {
      current = path[1].replace(/\{([a-zA-Z]+)\}/g, ':$1');
      continue;
    }
    const method = line.match(/^ {4}(get|post|put|delete|patch):\s*$/);
    if (method?.[1] && current) routes.push(`${method[1].toUpperCase()} ${current}`);
  }
  return routes;
}

describe('API contract', () => {
  const built = buildServer(makeDeps(), { logger: false });
  const { app } = built;

  it('registers exactly the routes declared in http-api.yaml', async () => {
    await app.ready();
    const actual = [...new Set(built.routePaths)].sort();
    const expected = declaredRoutes().sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  it('returns a schema-valid health payload with dead-letter visibility', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const parsed = healthSchema.parse(response.json());
    expect(parsed.database.reachable).toBe(true);
    expect(parsed.dead_letter?.count).toBe(0);
  });

  it('returns the chain list and the 13-template catalog', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/chains' });
    expect(response.statusCode).toBe(200);
    const parsed = chainsResponseSchema.parse(response.json());
    expect(parsed.chains.map((chain) => chain.chain_id)).toEqual([5_318_007, 1301]);
    expect(parsed.templates).toHaveLength(13);
  });

  it('returns schema-valid empty feeds', async () => {
    const executions = await app.inject({ method: 'GET', url: '/v1/executions' });
    expect(executionsResponseSchema.parse(executions.json()).executions).toEqual([]);

    const marketplace = await app.inject({ method: 'GET', url: '/v1/marketplace' });
    expect(listingsResponseSchema.parse(marketplace.json()).listings).toEqual([]);

    const leaderboard = await app.inject({ method: 'GET', url: '/v1/leaderboard' });
    expect(z.object({ rows: z.array(z.unknown()) }).parse(leaderboard.json()).rows).toEqual([]);
  });

  it('returns sponsor state for an account', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/sponsor/${AGENT}` });
    expect(sponsorStatusSchema.parse(response.json()).chains).toHaveLength(2);
  });

  it('exposes a detached mirror and retains its own execution history', async () => {
    const deps = makeDeps();
    const leader = '0x2222222222222222222222222222222222222222';
    const leaderVault = '0x3333333333333333333333333333333333333333';
    const followerVault = '0x4444444444444444444444444444444444444444';
    const leaderTx = `0x${'5'.repeat(64)}`;
    const followerTx = `0x${'6'.repeat(64)}`;
    const timestamp = '2026-11-18T00:00:00.000Z';
    await deps.repositories.rules.upsert({
      agent: AGENT,
      rule_id: '7',
      template: 3,
      chain_id: 1301,
      status: 'cancelled',
      latched: false,
      pair: null,
      token_in: null,
      token_out: null,
      amount_in: '500000',
      threshold: null,
      secondary: null,
      last_run_at: timestamp,
      runs: 1,
      is_public: false,
    });
    await deps.repositories.mirrors.upsert({
      follower_agent: AGENT,
      rule_id: '7',
      leader_agent: leader,
      leader_rule_id: '2',
      leader_vault: leaderVault,
      scale_bps: 5000,
      hourly_cap: 1,
      per_run_cap: '500000',
      detached_at: null,
    });
    await deps.repositories.mirrors.detach(AGENT, '7', timestamp);
    await deps.repositories.executions.upsert({
      chain_id: 1301,
      tx_hash: followerTx,
      log_index: 0,
      vault: followerVault,
      agent: AGENT,
      owner: AGENT,
      rule_id: '7',
      kind: 'mirrored',
      token_in: null,
      token_out: null,
      amount_in: null,
      amount_out: null,
      block_number: 12,
      block_time: timestamp,
      leader_tx: leaderTx,
      status: 'confirmed',
    });
    const { app: mirrorApp } = buildServer(deps, { logger: false });
    const response = await mirrorApp.inject(`/v1/accounts/${AGENT}/rules/7`);
    const detail = ruleDetailResponseSchema.parse(response.json());
    expect(detail.mirror).toMatchObject({
      leader_agent: leader,
      leader_rule_id: 2n,
      per_run_cap: 500_000n,
      detached_at: timestamp,
    });
    expect(detail.mirror_source).toBeUndefined();
    expect(detail.recent_executions).toMatchObject([{ kind: 'mirrored', leader_tx: leaderTx }]);
    await mirrorApp.close();
  });

  it('returns the canonical error shape for an unknown agent', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/accounts/${AGENT}` });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });

  it('returns 404 for a proof with no callback record', async () => {
    const hash = `0x${'1'.repeat(64)}`;
    const response = await app.inject({ method: 'GET', url: `/v1/proofs/${hash}` });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });

  it('encodes a complete draft and rejects an incomplete one', async () => {
    const complete = await app.inject({
      method: 'POST',
      url: '/v1/encode/preview',
      payload: {
        template: 1,
        chain_id: 1301,
        agent: AGENT,
        slots: {
          schedule: '86400',
          amount_in: '10000000',
          token_in: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
          token_out: '0x4200000000000000000000000000000000000006',
        },
      },
    });
    expect(complete.statusCode).toBe(200);
    const body = z
      .object({ to: z.string(), data: z.string().startsWith('0x'), readable_sentence: z.string() })
      .parse(complete.json());
    expect(body.readable_sentence).toContain('Every');

    const incomplete = await app.inject({
      method: 'POST',
      url: '/v1/encode/preview',
      payload: {
        template: 1,
        chain_id: 1301,
        slots: {
          token_in: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
          token_out: '0x4200000000000000000000000000000000000006',
        },
      },
    });
    expect(incomplete.statusCode).toBe(422);
    expect(apiErrorSchema.parse(incomplete.json()).error.code).toBe('incomplete_draft');
  });

  it('closes cleanly', async () => {
    await app.close();
  });
});
