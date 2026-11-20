import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('counts each copied wallet only when its exact attributed activation is authorized', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(
      await readFile(new URL('../db/migrations/0012_workflows.sql', import.meta.url), 'utf8'),
    );
    await db.exec(
      await readFile(new URL('../db/migrations/0014_workflow_v2.sql', import.meta.url), 'utf8'),
    );
    await db.exec(`
      insert into workflow_agents values ('original-agent', 'original'), ('copy-agent', 'copier');
      insert into workflow_vaults values
        ('copy-vault', 'copier', 'copy-agent'),
        ('wrong-vault', 'unrelated', 'copy-agent');
      insert into workflow_market_listings values
        (1, 'original', 'original-agent', 'original-id', 'original-hash', '0x01',
         'Save a payment', 'Put some USDC aside', array['Payments'], 'payment', true, 100);
      insert into workflow_activations values
        ('copy-agent', 'copy-id', 1, 'first-hash', 'Copy', 1),
        ('copy-agent', 'copy-id', 2, 'new-hash', 'Edited copy', 0),
        ('original-agent', 'self-copy', 1, 'self-hash', 'Self copy', 1);
      insert into workflow_authorizations values
        ('wrong-vault', 'copy-id', 1, 'first-hash'),
        ('copy-vault', 'copy-id', 2, 'new-hash');
    `);
    async function count() {
      const data = await db.query<{ copies: number }>(
        'select copies::int from workflow_marketplace where id = 1',
      );
      return data.rows[0]?.copies;
    }
    expect(await count()).toBe(0);
    await db.exec(`
      insert into workflow_authorizations values
        ('copy-vault', 'copy-id', 1, 'first-hash'),
        ('copy-vault', 'another-copy', 1, 'another-hash');
      insert into workflow_activations values
        ('copy-agent', 'another-copy', 1, 'another-hash', 'Another copy', 1);
    `);
    expect(await count()).toBe(1);
    const page = await db.query<{ listing_id: string }>(
      "select listing_id from browse_workflow_marketplace('usdc', 'Payments', 'payment', 'popular', null, null, 10)",
    );
    expect(page.rows).toEqual([{ listing_id: '1' }]);
  } finally {
    await db.close();
  }
});
