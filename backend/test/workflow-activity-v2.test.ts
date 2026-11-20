import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { createClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
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
    expect(requests[1]?.searchParams.get('deployment')).toBe(`eq.${factory}`);
    expect(requests[1]?.searchParams.get('id')).toBe(`eq.${runId}`);
    expect(requests[1]?.searchParams.get('select')).not.toContain('title');
    expect((await app.inject({ url: '/v3/runs/invalid' })).statusCode).toBe(400);
    expect((await app.inject({ url: `/v3/runs/${hash}` })).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
