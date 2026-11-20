import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('lists a wallet’s activity across workflows with stable pages and verified outcomes', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const migration of [
      '0012_workflows.sql',
      '0013_workflow_activity.sql',
      '0014_workflow_v2.sql',
    ]) {
      await db.exec(
        await readFile(new URL(`../db/migrations/${migration}`, import.meta.url), 'utf8'),
      );
    }
    await db.exec(`
      insert into workflow_agents values ('my-agent', 'owner'), ('other-agent', 'other');
      insert into workflow_vaults values ('my-vault', 'owner', 'my-agent'), ('other-vault', 'other', 'my-agent');
      insert into workflow_activations values
        ('my-agent', 'payment', 1, 'first', 'Original payment', 0),
        ('my-agent', 'payment', 2, 'later', 'Renamed payment', 0),
        ('my-agent', 'schedule', 1, 'first', 'Scheduled transfer', 0);
      insert into workflow_decisions values
        ('run-5', 'my-agent', 'payment', 'first', '0x01', 1, 0, '0', 1301, 'tx', '0', 'lasna', 100, 1, false),
        ('run-4', 'my-agent', 'schedule', 'first', '0x01', 1, 0, '0', 1301, 'tx', '0', 'lasna', 100, 1, false),
        ('run-3', 'my-agent', 'schedule', 'first', '0x01', 1, 0, '0', 1301, 'tx', '0', 'lasna', 99, 1, true),
        ('run-2', 'my-agent', 'payment', 'later', '0x01', 2, 0, '0', 1301, 'tx', '0', 'lasna', 98, 9999999999, false),
        ('run-1', 'my-agent', 'schedule', 'first', '0x01', 1, 0, '0', 1301, 'tx', '0', 'lasna', 97, 1, false),
        ('outsider', 'other-agent', 'schedule', 'first', '0x01', 1, 0, '0', 1301, 'tx', '0', 'lasna', 101, 1, false);
      insert into workflow_outcomes values
        ('run-5', 'my-vault', 'payment', 'first', 1, 0, 'destination', true, ''),
        ('run-4', 'my-vault', 'schedule', 'first', 1, 0, 'destination', false, ''),
        ('run-1', 'other-vault', 'schedule', 'first', 1, 0, 'destination', true, '');
    `);
    async function page(
      attention: boolean,
      block: number | null,
      run: string | null,
      limit: number,
    ) {
      return (
        await db.query<{ id: string; title: string | null; status: string }>(
          'select id, title, status from list_workflow_activity($1, $2, $3, $4, $5)',
          ['owner', attention, block, run, limit],
        )
      ).rows;
    }
    expect(await page(false, null, null, 1)).toEqual([
      { id: 'run-5', title: 'Original payment', status: 'Completed' },
    ]);
    expect(await page(false, 100, 'run-5', 4)).toEqual([
      { id: 'run-4', title: 'Scheduled transfer', status: 'Failed' },
      { id: 'run-3', title: 'Scheduled transfer', status: 'Skipped' },
      { id: 'run-2', title: 'Renamed payment', status: 'Waiting for confirmation' },
      { id: 'run-1', title: 'Scheduled transfer', status: 'No result confirmed' },
    ]);
    expect((await page(true, null, null, 10)).map((run) => run.id)).toEqual(['run-4', 'run-1']);
    const grants = await db.query<{ anon: boolean; service: boolean }>(`
      select has_function_privilege('anon', 'list_workflow_activity(text,boolean,bigint,text,integer)', 'execute') as anon,
        has_function_privilege('service_role', 'list_workflow_activity(text,boolean,bigint,text,integer)', 'execute') as service
    `);
    expect(grants.rows).toEqual([{ anon: false, service: true }]);
  } finally {
    await db.close();
  }
});
