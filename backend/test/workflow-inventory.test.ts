import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('pages the wallet inventory, persists archive and restore, and rejects old revisions', async () => {
  const db = new PGlite();
  try {
    for (const file of [
      '0014_workflow_v2.sql',
      '0032_workflow_inventory_and_archive.sql',
      '0033_atomic_workflow_inventory_batches.sql',
      '0034_scope_workflow_inventory_sync.sql',
    ]) {
      await db.exec(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await db.exec(`
      insert into workflow_v2_accounts values
        ('test', 1301, 'vault', 'owner', 'agent'),
        ('test', 84532, 'base-vault', 'owner', 'agent'),
        ('test', 1301, 'other-vault', 'other', 'other-agent'),
        ('main', 1301, 'vault', 'owner', 'agent');
      insert into workflow_v2_cursors values ('test', 1301, 30), ('test', 84532, 30);
      insert into workflow_v2_inventory_cursors values ('test', 1301, 30), ('test', 84532, 29);
      insert into workflow_v2_authorization_events values
        ('test', 1301, 'vault', 'a', 1, 10, 0),
        ('test', 1301, 'vault', 'b', 1, 10, 1),
        ('test', 1301, 'vault', 'a', 2, 10, 2),
        ('test', 84532, 'base-vault', 'a', 1, 10, 0),
        ('test', 1301, 'other-vault', 'c', 1, 10, 3),
        ('main', 1301, 'vault', 'd', 1, 10, 0);
    `);
    const page = async (
      archived = false,
      chain?: number,
      id?: string,
      before = false,
      owner = 'owner',
    ) => {
      const { rows } = await db.query<{ result: unknown }>(
        'select workflow_v2_inventory_page($1, $2, $3, $4, $5, $6, $7, 2) as result',
        ['test', owner, [1301, 84532], archived, chain ?? null, id ?? null, before],
      );
      return rows[0]?.result;
    };
    const change = async (revision: number, archived: boolean) => {
      const { rows } = await db.query<{ changed: boolean }>(
        'select workflow_v2_write_archive($1, $2, $3, $4, $5, $6, $7) as changed',
        ['test', 1301, 'owner', 'a', revision, 2, archived],
      );
      return rows[0]?.changed;
    };
    expect(await page()).toEqual({
      items: [
        { chain: 1301, id: 'a' },
        { chain: 1301, id: 'b' },
      ],
      total: 3,
      syncing: false,
    });
    await db.exec('update workflow_v2_cursors set block_number = 94 where chain = 84532');
    expect(await page()).toMatchObject({ syncing: true });
    expect(await page(false, undefined, undefined, false, 'other')).toMatchObject({
      syncing: false,
    });
    expect(await page(false, undefined, undefined, false, 'new-wallet')).toMatchObject({
      syncing: false,
    });
    await db.exec('delete from workflow_v2_inventory_cursors where chain = 84532');
    expect(await page()).toMatchObject({ syncing: true });
    expect(await page(false, 1301, 'b')).toMatchObject({ items: [{ chain: 84532, id: 'a' }] });
    expect(await page(false, 84532, 'a', true)).toMatchObject({
      items: [
        { chain: 1301, id: 'b' },
        { chain: 1301, id: 'a' },
      ],
    });
    expect(await change(0, true)).toBe(true);
    expect(await change(0, true)).toBe(false);
    expect(await change(0, false)).toBe(false);
    expect(await page(true)).toMatchObject({ items: [{ chain: 1301, id: 'a' }], total: 1 });
    expect(await page()).toMatchObject({
      items: [
        { chain: 1301, id: 'b' },
        { chain: 84532, id: 'a' },
      ],
      total: 2,
    });
    expect(await change(1, false)).toBe(true);
    expect(await page(true)).toMatchObject({ items: [], total: 0 });
    expect(await change(2, true)).toBe(true);
    await db.exec(
      `insert into workflow_v2_authorization_events values ('test', 1301, 'vault', 'a', 3, 11, 0)`,
    );
    expect(await page(true)).toMatchObject({ items: [], total: 0 });

    const applyBatch = async (
      previous: number,
      previousHash: string | null,
      block: number,
      hash: string | null,
      events: object[] | null,
    ) => {
      const { rows } = await db.query<{ applied: boolean }>(
        'select workflow_v2_apply_inventory_batch($1, $2, $3, $4, $5, $6, $7) as applied',
        [
          'test',
          1301,
          previous,
          previousHash,
          block,
          hash,
          events === null ? null : JSON.stringify(events),
        ],
      );
      return rows[0]?.applied;
    };
    const newEvent = {
      vault: 'vault',
      workflow_id: 'e',
      epoch: '1',
      block_number: 31,
      log_index: 0,
    };
    await expect(applyBatch(30, null, 31, 'bad', [newEvent, newEvent])).rejects.toThrow();
    expect(await applyBatch(30, null, 31, 'first', [newEvent])).toBe(true);
    expect(await applyBatch(30, null, 32, 'stale', [])).toBe(false);
    expect(await page(false, 1301, 'b')).toMatchObject({
      items: [
        { chain: 1301, id: 'e' },
        { chain: 84532, id: 'a' },
      ],
    });
    expect(await applyBatch(31, 'first', 30, null, null)).toBe(true);
    expect(await applyBatch(30, null, 31, 'canonical', [])).toBe(true);
    expect(await page(false, 1301, 'b')).toMatchObject({ items: [{ chain: 84532, id: 'a' }] });
  } finally {
    await db.close();
  }
});
