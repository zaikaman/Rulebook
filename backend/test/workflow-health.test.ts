import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
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
    expect(requests[0]?.body).toEqual({ p_deployment: factory, p_owner: owner });
    expect((await app.inject({ url: '/v3/health?owner=bad' })).statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
