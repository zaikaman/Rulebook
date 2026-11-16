import { onboardingResponseSchema, starterFundsResponseSchema } from '@rulebook/shared';
import type { Address, Hex } from 'viem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../src/config.js';
import { createRepositories } from '../../src/db/repositories/index.js';
import { InMemoryStore } from '../../src/db/store.js';
import type { ServerDeps } from '../../src/deps.js';
import { CursorStore } from '../../src/indexer/cursors.js';
import { buildServer } from '../../src/server.js';
import type { OnboardingRelayer } from '../../src/sponsor/relayer.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const STRANGER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
const AGENT = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
const VAULT = '0xdddddddddddddddddddddddddddddddddddddddd' as Address;
const HASH = `0x${'1'.repeat(64)}` as Hex;
const HASH2 = `0x${'2'.repeat(64)}` as Hex;

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
  AGENT_FACTORY_ADDRESS: '0x1111111111111111111111111111111111111111',
  VAULT_FACTORY_ADDRESS: '0x2222222222222222222222222222222222222222',
  SPONSOR_GAS_TOP_UP_WEI: '50000000000000000',
  SPONSOR_RESERVE_TARGET_WEI: '200000000000000000',
  STARTER_FUNDS_USDC: '10000000',
  STARTER_FUNDS_WETH: '10000000000000000',
  ONBOARDING_RATE_LIMIT_PER_MINUTE: 3,
  ONBOARDING_DAILY_CAP: 100,
  corsOrigins: ['http://localhost:5173'],
};

interface State {
  agent: Address | null;
  vault: Address | null;
  link: Address | null;
  vaultOwner: Address | null;
  agentDeploys: number;
  vaultDeploys: number;
  starterCalls: number;
  failVault: boolean;
}

function makeState(): State {
  return {
    agent: null,
    vault: null,
    link: null,
    vaultOwner: OWNER,
    agentDeploys: 0,
    vaultDeploys: 0,
    starterCalls: 0,
    failVault: false,
  };
}

function makeRelayer(state: State): OnboardingRelayer {
  return {
    agentOf: async () => state.agent,
    vaultOf: async () => state.vault,
    vaultOwner: async () => state.vaultOwner,
    agentLink: async () => state.link,
    deployAgent: async () => {
      state.agentDeploys += 1;
      state.agent = AGENT;
      return { address: AGENT, txHash: HASH, blockNumber: 1 };
    },
    deployVault: async () => {
      state.vaultDeploys += 1;
      if (state.failVault) throw new Error('vault factory reverted');
      state.vault = VAULT;
      return { address: VAULT, txHash: HASH, blockNumber: 2 };
    },
    topUpUserGas: async () => null,
    fundAgentReserves: async () => null,
    sendStarterFunds: async () => {
      state.starterCalls += 1;
      return { txHashes: [HASH, HASH2], amountUsdc: 10n, amountWeth: 2n };
    },
  };
}

function makeHarness(state: State, allow = true) {
  const store = new InMemoryStore();
  const deps: ServerDeps = {
    config,
    repositories: createRepositories(store),
    cursors: new CursorStore(store),
    databaseReachable: async () => true,
    rpcHealth: async () => [],
    relayer: makeRelayer(state),
    accountChain: {
      agentLink: async () => state.link,
      vaultOwner: async () => state.vaultOwner,
    },
    onboardingLimiter: { allow: () => allow },
  };
  return { app: buildServer(deps, { logger: false }).app, store, deps };
}

describe('POST /v1/onboarding', () => {
  let state: State;

  beforeEach(() => {
    state = makeState();
  });

  it('deploys agent then vault, and is idempotent on retry', async () => {
    const { app, store } = makeHarness(state);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      payload: { owner: OWNER },
    });
    expect(first.statusCode).toBe(200);
    const body = onboardingResponseSchema.parse(first.json());
    expect(body.setup_state).toBe('partial');
    expect(body.agent).toBe(AGENT);
    expect(body.vault).toBe(VAULT);
    expect(body.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'agent', status: 'confirmed' }),
        expect.objectContaining({ name: 'vault', status: 'confirmed' }),
        expect.objectContaining({
          name: 'link',
          status: 'skipped',
          error: 'owner_signature_required',
        }),
      ]),
    );

    expect(await store.count('agents', { address: AGENT })).toBe(1);
    expect(await store.count('vaults', { address: VAULT })).toBe(1);

    state.link = VAULT;
    const second = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      payload: { owner: OWNER },
    });
    const retried = onboardingResponseSchema.parse(second.json());
    expect(retried.setup_state).toBe('complete');
    expect(retried.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'agent', status: 'skipped' }),
        expect.objectContaining({ name: 'vault', status: 'skipped' }),
      ]),
    );
    expect(state.agentDeploys).toBe(1);
    expect(state.vaultDeploys).toBe(1);

    await app.close();
  });

  it('resumes agent_only without redeploying the agent or restarting the completed step', async () => {
    state.agent = AGENT;
    const { app } = makeHarness(state);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      payload: { owner: OWNER },
    });
    const body = onboardingResponseSchema.parse(response.json());

    expect(state.agentDeploys).toBe(0);
    expect(state.vaultDeploys).toBe(1);
    expect(body.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'agent', status: 'skipped' })]),
    );

    await app.close();
  });

  it('keeps a deployed agent resumable when the vault step fails', async () => {
    state.failVault = true;
    const { app } = makeHarness(state);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      payload: { owner: OWNER },
    });
    const body = onboardingResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.setup_state).toBe('agent_only');
    expect(body.agent).toBe(AGENT);
    expect(body.vault).toBeUndefined();
    expect(body.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'vault', status: 'failed' })]),
    );

    await app.close();
  });

  it('refuses before deploying when the relayer is unavailable', async () => {
    const store = new InMemoryStore();
    const { app } = buildServer(
      {
        config,
        repositories: createRepositories(store),
        cursors: new CursorStore(store),
        databaseReachable: async () => true,
        rpcHealth: async () => [],
        accountChain: { agentLink: async () => null, vaultOwner: async () => null },
        onboardingLimiter: { allow: () => true },
      },
      { logger: false },
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      payload: { owner: OWNER },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it('rate limits a retry loop', async () => {
    const { app } = makeHarness(state, false);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      payload: { owner: OWNER },
    });
    expect(response.statusCode).toBe(429);
    expect(state.agentDeploys).toBe(0);
    await app.close();
  });

  it('derives complete/partial/agent_only from indexed rows and the chain link', async () => {
    state.agent = AGENT;
    const { app, deps } = makeHarness(state);
    await deps.repositories.agents.upsert({
      address: AGENT,
      owner: OWNER,
      factory: '0x1111111111111111111111111111111111111111',
      created_tx: HASH,
      created_block: 1,
      rule_count: 0,
      chain_id: 5_318_007,
    });

    const agentOnly = await app.inject({ method: 'GET', url: `/v1/accounts/${AGENT}` });
    expect(agentOnly.json().setup_state).toBe('agent_only');

    await deps.repositories.vaults.upsert({
      address: VAULT,
      owner: OWNER,
      agent: AGENT,
      chain_id: 1301,
      created_tx: HASH,
      mirror_mode: false,
      allowed_token_in: null,
      allowed_token_out: null,
      max_spend_per_run: null,
      paused: false,
    });

    const partial = await app.inject({ method: 'GET', url: `/v1/accounts/${AGENT}` });
    expect(partial.json().setup_state).toBe('partial');
    expect(partial.json().vaults[0].connected).toBe(false);

    state.link = VAULT;
    const complete = await app.inject({ method: 'GET', url: `/v1/accounts/${AGENT}` });
    expect(complete.json().setup_state).toBe('complete');
    expect(complete.json().vaults[0].connected).toBe(true);

    await app.close();
  });
});

describe('POST /v1/starter-funds', () => {
  let state: State;

  beforeEach(() => {
    state = makeState();
    state.agent = AGENT;
    state.vault = VAULT;
    state.link = VAULT;
  });

  it('refuses a vault owned by another address', async () => {
    state.vaultOwner = STRANGER;
    const { app } = makeHarness(state);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/starter-funds',
      payload: { owner: OWNER, vault: VAULT },
    });
    expect(response.statusCode).toBe(403);
    expect(state.starterCalls).toBe(0);
    await app.close();
  });

  it('claims once and returns both transfer hashes', async () => {
    const { app } = makeHarness(state);
    const first = await app.inject({
      method: 'POST',
      url: '/v1/starter-funds',
      payload: { owner: OWNER, vault: VAULT },
    });
    expect(first.statusCode).toBe(200);
    const body = starterFundsResponseSchema.parse(first.json());
    expect(body.amount_usdc).toBe(10n);
    expect(body.tx_hashes).toHaveLength(2);

    const repeat = await app.inject({
      method: 'POST',
      url: '/v1/starter-funds',
      payload: { owner: OWNER, vault: VAULT },
    });
    expect(repeat.statusCode).toBe(409);
    expect(state.starterCalls).toBe(1);
    await app.close();
  });

  it('releases the claim when the transfer fails, so a retry is possible', async () => {
    const { app, deps } = makeHarness(state);
    const relayer = deps.relayer as OnboardingRelayer;
    relayer.sendStarterFunds = async () => {
      throw new Error('token transfer reverted');
    };

    const failed = await app.inject({
      method: 'POST',
      url: '/v1/starter-funds',
      payload: { owner: OWNER, vault: VAULT },
    });
    expect(failed.statusCode).toBe(502);
    expect(await deps.repositories.starterFunds.get(OWNER)).toBeNull();

    await app.close();
  });
});
