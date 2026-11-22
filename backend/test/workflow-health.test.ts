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
const inFlightId = `0x${'5'.repeat(64)}`;

it('derives the latest run, last success, and in-flight callback from indexed evidence', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../db/migrations/0014_workflow_v2.sql', import.meta.url), 'utf8'),
    );
    await db.exec(
      await readFile(new URL('../db/migrations/0019_workflow_health.sql', import.meta.url), 'utf8'),
    );
    await db.exec(`
      insert into workflow_v2_accounts values
        ('current', 5318007, 'agent', 'owner', 'agent'),
        ('current', 1301, 'vault', 'owner', 'agent');
      insert into workflow_v2_activations values
        ('current', 1301, 'agent', '${workflowId}', '1', 'hash-1', 'Recurring transfer');
      insert into workflow_v2_runs values
        ('current', 1301, '${successId}', 'agent', '${workflowId}', 'hash-1', '1', 1301, '${hash}', '0', '${hash}', 100, 1),
        ('current', 1301, '${failedId}', 'agent', '${workflowId}', 'hash-1', '1', 1301, '${hash}', '1', '${hash}', 102, 1),
        ('current', 1301, '${inFlightId}', 'agent', '${workflowId}', 'hash-1', '1', 1301, '${hash}', '2', '${hash}', 103, 9999999999);
      insert into workflow_v2_outcomes values
        ('current', 1301, '${successId}', '${workflowId}', 'vault', '1', '${hash}', 90, 0, 1, '0x00000000', 4),
        ('current', 1301, '${failedId}', '${workflowId}', 'vault', '1', '${hash}', 91, 1, 4, '0x12345678', null),
        ('current', 1301, '${inFlightId}', '${workflowId}', 'vault', '1', '${hash}', 92, 2, 6, '0x00000000', null);
    `);
    const { rows } = await db.query(`
      select last_run_id, last_status, last_success_id, pending_run_id
      from workflow_v2_health('current', 'owner')
    `);
    expect(rows).toEqual([
      {
        last_run_id: inFlightId,
        last_status: 'in grace period',
        last_success_id: successId,
        pending_run_id: inFlightId,
      },
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
