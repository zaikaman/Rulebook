import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  healthSchema,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowDeploymentKey,
} from '@rulebook/shared';
import { createClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import { toFunctionSelector, zeroHash } from 'viem';
import { expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { registerWorkflowV2Routes } from '../src/workflows/routesV2.js';

it('reads the confirmed branch only from the matching deployment, owner, workflow and epoch', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../db/migrations/0014_workflow_v2.sql', import.meta.url), 'utf8'),
    );
    await db.exec(`
      insert into workflow_v2_accounts values
        ('current', 5318007, 'agent', 'owner', 'agent'),
        ('current', 1301, 'vault', 'owner', 'agent'),
        ('current', 1301, 'other-vault', 'other', 'agent'),
        ('other-deployment', 1301, 'vault', 'owner', 'agent');
      insert into workflow_v2_activations values
        ('current', 1301, 'agent', 'workflow', '1', 'hash-1', 'Payment');
      insert into workflow_v2_runs values
        ('current', 1301, 'settled', 'agent', 'workflow', 'hash-1', '1', 1301, 'origin', '0', 'lasna', 100, 1),
        ('current', 1301, 'expired', 'agent', 'workflow', 'hash-1', '1', 1301, 'origin', '1', 'lasna', 101, 1),
        ('current', 1301, 'pending', 'agent', 'workflow', 'hash-1', '1', 1301, 'origin', '2', 'lasna', 102, 9999999999);
      insert into workflow_v2_outcomes values
        ('current', 1301, 'settled', 'workflow', 'vault', '1', 'settlement', 90, 0, 1, '0x00000000', 4),
        ('current', 1301, 'settled', 'workflow', 'other-vault', '1', 'other-owner', 91, 0, 4, '0xabcddcba', null),
        ('current', 1301, 'settled', 'workflow', 'vault', '2', 'other-epoch', 92, 0, 4, '0xabcddcba', null),
        ('other-deployment', 1301, 'settled', 'workflow', 'vault', '1', 'other-deploy', 93, 0, 4, '0xabcddcba', null);
    `);
    const { rows } = await db.query(`
      select id, title, status, path, destination_transaction
      from workflow_v2_activity where deployment = 'current' and owner = 'owner'
      order by lasna_block
    `);
    expect(rows).toEqual([
      {
        id: 'settled',
        title: 'Payment',
        status: 'confirmed',
        path: 4,
        destination_transaction: 'settlement',
      },
      {
        id: 'expired',
        title: 'Payment',
        status: 'expired',
        path: null,
        destination_transaction: null,
      },
      {
        id: 'pending',
        title: 'Payment',
        status: 'pending',
        path: null,
        destination_transaction: null,
      },
    ]);
  } finally {
    await db.close();
  }
});

it('scopes Activity by wallet and workflow and exposes only chain evidence in public proofs', async () => {
  const factory = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const owner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const agent = '0xcccccccccccccccccccccccccccccccccccccccc';
  const runId = `0x${'1'.repeat(64)}`;
  const workflowId = `0x${'2'.repeat(64)}`;
  const hash = `0x${'3'.repeat(64)}`;
  const requests: URL[] = [];
  const row = {
    owner,
    agent,
    id: runId,
    workflow_id: workflowId,
    chain: UNICHAIN_SEPOLIA_CHAIN_ID,
    title: 'Personal workflow',
    program_hash: hash,
    epoch: '1',
    origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
    origin_transaction: hash,
    origin_log_index: '5',
    lasna_transaction: hash,
    lasna_block: 10,
    expires_at: 100,
    destination_transaction: hash,
    reason: null,
    path: 2,
    status: 'confirmed',
  };
  const db = createClient('https://database.example', 'fixture-key', {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return Response.json(
          url.searchParams.has('id') && url.searchParams.get('id') !== `eq.${runId}` ? [] : [row],
        );
      },
    },
  });
  const app = Fastify();
  registerWorkflowV2Routes(app, db, factory);
  try {
    const scoped = await app.inject({ url: `/v3/activity?owner=${owner}&workflow=${workflowId}` });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().runs[0]).toMatchObject({ workflowId, title: row.title });
    expect(requests[0]?.searchParams.get('owner')).toBe(`eq.${owner}`);
    expect(requests[0]?.searchParams.get('workflow_id')).toBe(`eq.${workflowId}`);

    const published = await app.inject({ url: `/v3/runs/${runId}` });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({
      id: runId,
      chain: row.chain,
      programHash: hash,
      originChain: row.origin_chain,
      originTransaction: hash,
      originLogIndex: '5',
      lasnaTransaction: hash,
      destinationTransaction: hash,
      expiresAt: 100,
      status: 'confirmed',
      path: 2,
      reason: null,
    });
    expect(requests[1]?.searchParams.get('deployment')).toBe(
      `eq.${workflowDeploymentKey(LASNA_CHAIN_ID, factory)}`,
    );
    expect(requests[1]?.searchParams.get('id')).toBe(`eq.${runId}`);
    expect(requests[1]?.searchParams.get('select')).not.toContain('title');
    expect((await app.inject({ url: '/v3/runs/invalid' })).statusCode).toBe(400);
    expect((await app.inject({ url: `/v3/runs/${hash}` })).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

it('queries and exposes public proofs for Base Sepolia settlement and cross-chain origin runs', async () => {
  const factory = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const owner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const runId = `0x${'4'.repeat(64)}`;
  const hash = `0x${'5'.repeat(64)}`;
  const requests: URL[] = [];
  const row = {
    id: runId,
    chain: BASE_SEPOLIA_CHAIN_ID,
    program_hash: hash,
    origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
    origin_transaction: hash,
    origin_log_index: '2',
    lasna_transaction: hash,
    destination_transaction: hash,
    expires_at: 200,
    reason: null,
    path: 1,
    status: 'confirmed',
  };
  const db = createClient('https://database.example', 'fixture-key', {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return Response.json([row]);
      },
    },
  });
  const app = Fastify();
  registerWorkflowV2Routes(app, db, factory);
  try {
    const published = await app.inject({ url: `/v3/runs/${runId}` });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({
      id: runId,
      chain: BASE_SEPOLIA_CHAIN_ID,
      programHash: hash,
      originChain: UNICHAIN_SEPOLIA_CHAIN_ID,
      originTransaction: hash,
      originLogIndex: '2',
      lasnaTransaction: hash,
      destinationTransaction: hash,
      expiresAt: 200,
      status: 'confirmed',
      path: 1,
      reason: null,
    });
    expect(requests[0]?.searchParams.get('chain')).toBe(
      `in.(${UNICHAIN_SEPOLIA_CHAIN_ID},${BASE_SEPOLIA_CHAIN_ID})`,
    );
    expect((await app.inject({ url: `/v3/runs/${runId}?owner=${owner}` })).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

it('filters /v3/marketplace and /v3/marketplace/:id by network chains and namespaced deployment even when factories match', async () => {
  const sharedFactory = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const rpcCalls: Array<{ fn: string; body: Record<string, unknown> }> = [];
  const db = createClient('https://database.example', 'fixture-key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const fn = url.pathname.split('/').pop() ?? '';
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        rpcCalls.push({ fn, body });
        if (fn === 'workflow_v2_marketplace_listing' && body.p_id === '1') {
          const isMainnet = String(body.p_deployment ?? '').includes(
            String(REACTIVE_MAINNET_CHAIN_ID),
          );
          const chain = isMainnet ? UNICHAIN_MAINNET_CHAIN_ID : UNICHAIN_SEPOLIA_CHAIN_ID;
          return Response.json([
            {
              id: '1',
              owner: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              agent: '0xcccccccccccccccccccccccccccccccccccccccc',
              workflow_id: `0x${'2'.repeat(64)}`,
              program_hash: `0x${'3'.repeat(64)}`,
              program: '0x01',
              chain,
              origin_chain: chain,
              trigger: 1,
              title: 'Listing',
              description: 'Details',
              block_number: 10,
              log_index: 0,
              verified_runs: 4,
            },
          ]);
        }
        return Response.json([]);
      },
    },
  });
  const app = Fastify();
  registerWorkflowV2Routes(app, db, { testnet: sharedFactory, mainnet: sharedFactory });
  try {
    expect((await app.inject({ url: '/v3/marketplace?network=testnet' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v3/marketplace?network=mainnet' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v3/marketplace/1?network=testnet' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v3/marketplace/1?network=mainnet' })).statusCode).toBe(200);

    expect(rpcCalls[0]).toEqual({
      fn: 'workflow_v2_marketplace_browse',
      body: {
        p_deployment: workflowDeploymentKey(LASNA_CHAIN_ID, sharedFactory),
        p_chains: [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
        p_query: null,
        p_cross_chain: null,
        p_trigger: null,
        p_before_block: null,
        p_before_index: null,
        p_limit: 25,
      },
    });
    expect(rpcCalls[1]).toEqual({
      fn: 'workflow_v2_marketplace_browse',
      body: {
        p_deployment: workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, sharedFactory),
        p_chains: [UNICHAIN_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID],
        p_query: null,
        p_cross_chain: null,
        p_trigger: null,
        p_before_block: null,
        p_before_index: null,
        p_limit: 25,
      },
    });
    expect(rpcCalls[2]).toEqual({
      fn: 'workflow_v2_marketplace_listing',
      body: {
        p_deployment: workflowDeploymentKey(LASNA_CHAIN_ID, sharedFactory),
        p_id: '1',
        p_chains: [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
      },
    });
    expect(rpcCalls[3]).toEqual({
      fn: 'workflow_v2_marketplace_listing',
      body: {
        p_deployment: workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, sharedFactory),
        p_id: '1',
        p_chains: [UNICHAIN_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID],
      },
    });

    // Reject chains that belong to the other network mode or invalid filter params.
    expect(
      (
        await app.inject({
          url: `/v3/marketplace?network=testnet&chain=${UNICHAIN_MAINNET_CHAIN_ID}`,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: '/v3/marketplace?network=testnet&trigger=bogus' })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: '/v3/marketplace?network=testnet&crossChain=maybe' })).statusCode,
    ).toBe(400);

    const outOfRangeCursor = Buffer.from(
      JSON.stringify({ block: 100, index: 2_147_483_648 }),
    ).toString('base64url');
    expect(
      (await app.inject({ url: `/v3/marketplace?network=testnet&after=${outOfRangeCursor}` }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: '/v3/marketplace?network=testnet&after=not-base64-json' }))
        .statusCode,
    ).toBe(400);

    const validCursor = Buffer.from(JSON.stringify({ block: 99, index: 3 })).toString('base64url');
    expect(
      (
        await app.inject({
          url: `/v3/marketplace?network=testnet&crossChain=false&after=${validCursor}`,
        })
      ).statusCode,
    ).toBe(200);
    expect(rpcCalls.at(-1)).toEqual({
      fn: 'workflow_v2_marketplace_browse',
      body: {
        p_deployment: workflowDeploymentKey(LASNA_CHAIN_ID, sharedFactory),
        p_chains: [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
        p_query: null,
        p_cross_chain: false,
        p_trigger: null,
        p_before_block: 99,
        p_before_index: 3,
        p_limit: 25,
      },
    });
  } finally {
    await app.close();
  }
});

it('enriches pending/expired runs with getCallbacks fallback, forwards marketplace search and filters, returns healthSchema on /health, and sanitizes 500 errors', async () => {
  const factory = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const agent = '0xcccccccccccccccccccccccccccccccccccccccc';
  const runId = `0x${'7'.repeat(64)}`;
  const hash = `0x${'8'.repeat(64)}`;
  const marketRpcBodies: Array<{ fn: string; body: Record<string, unknown> }> = [];
  const db = createClient('https://database.example', 'fixture-key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.includes('/rpc/')) {
          marketRpcBodies.push({
            fn: url.pathname.split('/').pop() ?? '',
            body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
          });
          return Response.json([]);
        }
        if (url.pathname.endsWith('/workflow_v2_activity')) {
          return Response.json({
            id: runId,
            agent,
            chain: UNICHAIN_SEPOLIA_CHAIN_ID,
            program_hash: hash,
            origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
            origin_transaction: hash,
            origin_log_index: '1',
            lasna_transaction: hash,
            destination_transaction: null,
            expires_at: 200,
            status: 'pending',
            path: null,
            reason: null,
          });
        }
        return Response.json([]);
      },
    },
  });

  const { app } = buildServer(
    {
      config: {
        PORT: 8787,
        NODE_ENV: 'test',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'unused',
        LASNA_RPC_URL: 'https://lasna-rpc.rnk.dev/',
        UNICHAIN_RPC_URL: 'https://sepolia.unichain.org',
        INDEXER_ENABLED: true,
        corsOrigins: [],
      },
      databaseReachable: async () => true,
      rpcHealth: async () => [{ chain_id: LASNA_CHAIN_ID, rpc_ok: true }],
      indexerHealth: async () => ({
        lag_seconds: 12,
        cursors: [
          {
            chain_id: LASNA_CHAIN_ID,
            last_block: 100,
            updated_at: new Date().toISOString(),
          },
        ],
        expected_chains: 1,
      }),
    },
    { logger: false },
  );

  app.get('/boom', async () => {
    throw new Error('https://secret-rpc.example/v2/my-secret-key failed');
  });

  registerWorkflowV2Routes(
    app,
    db,
    { testnet: factory },
    {
      testnet: {
        readCallbacks: async () => [
          {
            block_number: 50,
            reacting_contract: agent,
            callback_index: 0,
            destination_chain_id: UNICHAIN_SEPOLIA_CHAIN_ID,
            destination_tx_hash: zeroHash,
            error_data: toFunctionSelector('CapExceeded()'),
          },
        ],
      },
    },
  );

  try {
    const proof = await app.inject({ url: `/v3/runs/${runId}` });
    expect(proof.statusCode).toBe(200);
    expect(proof.json()).toMatchObject({
      status: 'failed',
      destinationTransaction: null,
      reason: 'The run exceeded the approved spending limit.',
    });

    await app.inject({
      url: `/v3/marketplace?q=${encodeURIComponent(' sweep ')}&chain=${BASE_SEPOLIA_CHAIN_ID}&crossChain=true&trigger=payment`,
    });
    expect(marketRpcBodies[0]).toEqual({
      fn: 'workflow_v2_marketplace_browse',
      body: {
        p_deployment: workflowDeploymentKey(LASNA_CHAIN_ID, factory),
        p_chains: [BASE_SEPOLIA_CHAIN_ID],
        p_query: 'sweep',
        p_cross_chain: true,
        p_trigger: 2,
        p_before_block: null,
        p_before_index: null,
        p_limit: 25,
      },
    });

    const healthRes = await app.inject({ url: '/health' });
    expect(healthRes.statusCode).toBe(200);
    expect(healthSchema.parse(healthRes.json())).toMatchObject({
      status: 'ok',
      indexer: { enabled: true, lag_seconds: 12 },
    });

    const boom = await app.inject({ url: '/boom' });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toEqual({
      error: {
        code: 'internal_error',
        message: 'Internal server error',
        detail: null,
      },
    });
  } finally {
    await app.close();
  }
});
