import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowDeploymentKey,
} from '@rulebook/shared';
import { createClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import { toFunctionSelector } from 'viem';
import { expect, it } from 'vitest';

import { registerWorkflowV2Routes } from '../src/workflows/routesV2.js';

const hash = `0x${'1'.repeat(64)}`;
const workflowId = `0x${'2'.repeat(64)}`;
const successId = `0x${'3'.repeat(64)}`;
const failedId = `0x${'4'.repeat(64)}`;
const graceId = `0x${'5'.repeat(64)}`;
const pendingId = `0x${'6'.repeat(64)}`;

async function healthDatabase() {
  const db = new PGlite();
  for (const file of [
    '0014_workflow_v2.sql',
    '0019_workflow_health.sql',
    '0020_workflow_health_grace.sql',
  ]) {
    await db.exec(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.exec(`
    insert into workflow_v2_accounts values
      ('current', 5318007, 'agent', 'owner', 'agent'),
      ('current', 1301, 'vault', 'owner', 'agent');
    insert into workflow_v2_activations values
      ('current', 1301, 'agent', '${workflowId}', '1', 'hash-1', 'Recurring transfer');
  `);
  return db;
}

it('derives the latest run, last success, and a grace-period run without a pending callback', async () => {
  const db = await healthDatabase();
  try {
    await db.exec(`
      insert into workflow_v2_runs values
        ('current', 1301, '${successId}', 'agent', '${workflowId}', 'hash-1', '1', 1301, '${hash}', '0', '${hash}', 100, 1),
        ('current', 1301, '${failedId}', 'agent', '${workflowId}', 'hash-1', '1', 1301, '${hash}', '1', '${hash}', 102, 1),
        ('current', 1301, '${graceId}', 'agent', '${workflowId}', 'hash-1', '1', 1301, '${hash}', '2', '${hash}', 103, 9999999999);
      insert into workflow_v2_outcomes values
        ('current', 1301, '${successId}', '${workflowId}', 'vault', '1', '${hash}', 90, 0, 1, '0x00000000', 4),
        ('current', 1301, '${failedId}', '${workflowId}', 'vault', '1', '${hash}', 91, 1, 4, '0x12345678', null),
        ('current', 1301, '${graceId}', '${workflowId}', 'vault', '1', '${hash}', 92, 2, 6, '0x00000000', null);
    `);
    const { rows } = await db.query(`
      select last_run_id, last_status, last_success_id, pending_run_id
      from workflow_v2_health('current', 'owner')
    `);
    expect(rows).toEqual([
      {
        last_run_id: graceId,
        last_status: 'in grace period',
        last_success_id: successId,
        pending_run_id: null,
      },
    ]);
  } finally {
    await db.close();
  }
});

it('keeps an older unconfirmed callback pending while the newest run is in grace period', async () => {
  const db = await healthDatabase();
  try {
    await db.exec(`
      insert into workflow_v2_runs values
        ('current', 1301, '${pendingId}', 'agent', '${workflowId}', 'hash-1', '1', 1301, '${hash}', '1', '${hash}', 102, 9999999999),
        ('current', 1301, '${graceId}', 'agent', '${workflowId}', 'hash-1', '1', 1301, '${hash}', '2', '${hash}', 103, 9999999999);
      insert into workflow_v2_outcomes values
        ('current', 1301, '${graceId}', '${workflowId}', 'vault', '1', '${hash}', 92, 2, 6, '0x00000000', null);
    `);
    const { rows } = await db.query(`
      select last_run_id, last_status, pending_run_id
      from workflow_v2_health('current', 'owner')
    `);
    expect(rows).toEqual([
      { last_run_id: graceId, last_status: 'in grace period', pending_run_id: pendingId },
    ]);
  } finally {
    await db.close();
  }
});

it('returns workflow health only for the requested owner and deployment', async () => {
  const factory = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const owner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const requests: { url: URL; body: unknown }[] = [];
  const row = {
    chain: UNICHAIN_SEPOLIA_CHAIN_ID,
    workflow_id: workflowId,
    last_run_id: failedId,
    last_status: 'failed',
    last_reason: toFunctionSelector('WeeklyBudgetExceeded()'),
    last_expires_at: 100,
    last_path: null,
    last_lasna_transaction: hash,
    last_destination_transaction: hash,
    last_success_id: successId,
    last_success_path: 2,
    last_success_lasna_transaction: hash,
    last_success_destination_transaction: hash,
    pending_run_id: null,
    pending_expires_at: null,
  };
  const db = createClient('https://database.example', 'fixture-key', {
    global: {
      fetch: async (input, init) => {
        requests.push({
          url: new URL(String(input)),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json([row]);
      },
    },
  });
  const app = Fastify();
  registerWorkflowV2Routes(app, db, factory);
  try {
    const response = await app.inject({ url: `/v3/health?owner=${owner}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workflows: [
        {
          chain: UNICHAIN_SEPOLIA_CHAIN_ID,
          workflowId,
          lastRun: {
            id: failedId,
            status: 'failed',
            reason: 'Run would exceed the weekly spending budget',
            reasonCode: toFunctionSelector('WeeklyBudgetExceeded()'),
            recovery: 'limits',
            lasnaTransaction: hash,
            destinationTransaction: hash,
            path: null,
            expiresAt: 100,
          },
          lastSuccess: {
            id: successId,
            lasnaTransaction: hash,
            destinationTransaction: hash,
            path: 2,
          },
          pending: null,
        },
      ],
    });
    expect(requests[0]?.url.pathname).toBe('/rest/v1/rpc/workflow_v2_health');
    expect(requests[0]?.body).toEqual({
      p_deployment: workflowDeploymentKey(LASNA_CHAIN_ID, factory),
      p_owner: owner,
      p_chains: [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
    });
    expect((await app.inject({ url: '/v3/health?owner=bad' })).statusCode).toBe(400);
  } finally {
    await app.close();
  }
});

it('keys workflow_v2_health by (chain, workflow_id) and returns distinct rows for duplicate workflowIds across settlement chains', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files) {
      await db.exec(await readFile(join(migrationsDir, file), 'utf8'));
    }
    await db.exec(`
      insert into workflow_v2_accounts values
        ('current', 5318007, 'agent', 'owner', 'agent'),
        ('current', ${UNICHAIN_SEPOLIA_CHAIN_ID}, 'vault-uni', 'owner', 'agent'),
        ('current', ${BASE_SEPOLIA_CHAIN_ID}, 'vault-base', 'owner', 'agent');
      insert into workflow_v2_activations values
        ('current', ${UNICHAIN_SEPOLIA_CHAIN_ID}, 'agent', '${workflowId}', '1', 'hash-u', 'Unichain rule'),
        ('current', ${BASE_SEPOLIA_CHAIN_ID}, 'agent', '${workflowId}', '1', 'hash-b', 'Base rule');
      insert into workflow_v2_runs values
        ('current', ${UNICHAIN_SEPOLIA_CHAIN_ID}, '${successId}', 'agent', '${workflowId}', 'hash-u', '1', ${UNICHAIN_SEPOLIA_CHAIN_ID}, '${hash}', '0', '${hash}', 100, 1),
        ('current', ${BASE_SEPOLIA_CHAIN_ID}, '${failedId}', 'agent', '${workflowId}', 'hash-b', '1', ${BASE_SEPOLIA_CHAIN_ID}, '${hash}', '1', '${hash}', 200, 1);
      insert into workflow_v2_outcomes values
        ('current', ${UNICHAIN_SEPOLIA_CHAIN_ID}, '${successId}', '${workflowId}', 'vault-uni', '1', '${hash}', 90, 0, 1, '0x00000000', 4),
        ('current', ${BASE_SEPOLIA_CHAIN_ID}, '${failedId}', '${workflowId}', 'vault-base', '1', '${hash}', 91, 1, 4, '0x12345678', null);
    `);

    const { rows } = await db.query(
      `select chain, workflow_id, last_run_id, last_status
       from workflow_v2_health('current', 'owner', array[${UNICHAIN_SEPOLIA_CHAIN_ID}, ${BASE_SEPOLIA_CHAIN_ID}])
       order by chain`,
    );
    expect(rows).toEqual([
      {
        chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        workflow_id: workflowId,
        last_run_id: successId,
        last_status: 'confirmed',
      },
      {
        chain: BASE_SEPOLIA_CHAIN_ID,
        workflow_id: workflowId,
        last_run_id: failedId,
        last_status: 'failed',
      },
    ]);
  } finally {
    await db.close();
  }
});

it('filters workflow_v2_health strictly by p_chains in SQL', async () => {
  const db = await healthDatabase();
  try {
    await db.exec(
      `
      drop function workflow_v2_health(text, text);
      create function workflow_v2_health(p_deployment text, p_owner text, p_chains integer[] default null)
      returns table (
        workflow_id text,
        last_run_id text,
        last_status text,
        last_reason text,
        last_expires_at bigint,
        last_path smallint,
        last_lasna_transaction text,
        last_destination_transaction text,
        last_success_id text,
        last_success_path smallint,
        last_success_lasna_transaction text,
        last_success_destination_transaction text,
        pending_run_id text,
        pending_expires_at bigint
      ) language sql stable set search_path = public as $$
        with latest as (
          select distinct on (workflow_id) *
          from workflow_v2_activity
          where deployment = p_deployment and owner = p_owner
            and (p_chains is null or chain = any(p_chains))
          order by workflow_id, lasna_block desc, id desc, chain desc
        ),
        success as (
          select distinct on (workflow_id) *
          from workflow_v2_activity
          where deployment = p_deployment and owner = p_owner
            and (p_chains is null or chain = any(p_chains))
            and status = 'confirmed'
          order by workflow_id, lasna_block desc, id desc, chain desc
        ),
        pending as (
          select distinct on (workflow_id) *
          from workflow_v2_activity
          where deployment = p_deployment and owner = p_owner
            and (p_chains is null or chain = any(p_chains))
            and status = 'pending'
          order by workflow_id, lasna_block desc, id desc, chain desc
        )
        select
          latest.workflow_id, latest.id, latest.status, latest.reason, latest.expires_at,
          latest.path, latest.lasna_transaction, latest.destination_transaction,
          success.id, success.path, success.lasna_transaction, success.destination_transaction,
          pending.id, pending.expires_at
        from latest
        left join success using (workflow_id)
        left join pending using (workflow_id);
      $$;
    `,
    );
    await db.exec(`
      insert into workflow_v2_accounts values
        ('current', 1597, 'agent', 'owner', 'agent'),
        ('current', ${UNICHAIN_MAINNET_CHAIN_ID}, 'vault-main', 'owner', 'agent');
      insert into workflow_v2_activations values
        ('current', ${UNICHAIN_MAINNET_CHAIN_ID}, 'agent', '${workflowId}', '1', 'hash-1', 'Mainnet transfer');
      insert into workflow_v2_runs values
        ('current', ${UNICHAIN_SEPOLIA_CHAIN_ID}, '${successId}', 'agent', '${workflowId}', 'hash-1', '1', ${UNICHAIN_SEPOLIA_CHAIN_ID}, '${hash}', '0', '${hash}', 100, 1),
        ('current', ${UNICHAIN_MAINNET_CHAIN_ID}, '${failedId}', 'agent', '${workflowId}', 'hash-1', '1', ${UNICHAIN_MAINNET_CHAIN_ID}, '${hash}', '1', '${hash}', 200, 1);
      insert into workflow_v2_outcomes values
        ('current', ${UNICHAIN_SEPOLIA_CHAIN_ID}, '${successId}', '${workflowId}', 'vault', '1', '${hash}', 90, 0, 1, '0x00000000', 4),
        ('current', ${UNICHAIN_MAINNET_CHAIN_ID}, '${failedId}', '${workflowId}', 'vault-main', '1', '${hash}', 91, 1, 4, '0x12345678', null);
    `);

    const testnetHealth = await db.query(
      `select last_run_id, last_status from workflow_v2_health('current', 'owner', array[${UNICHAIN_SEPOLIA_CHAIN_ID}, ${BASE_SEPOLIA_CHAIN_ID}])`,
    );
    expect(testnetHealth.rows).toEqual([{ last_run_id: successId, last_status: 'confirmed' }]);

    const mainnetHealth = await db.query(
      `select last_run_id, last_status from workflow_v2_health('current', 'owner', array[${UNICHAIN_MAINNET_CHAIN_ID}])`,
    );
    expect(mainnetHealth.rows).toEqual([{ last_run_id: failedId, last_status: 'failed' }]);
  } finally {
    await db.close();
  }
});
