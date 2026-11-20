import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

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
