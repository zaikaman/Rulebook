import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  BASE_SEPOLIA_CHAIN_ID,
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowV2Action,
  workflowV2Nodes,
  workflowV2Trigger,
  workflowV2Unit,
} from '@rulebook/shared';
import { zeroAddress } from 'viem';
import { expect, it } from 'vitest';

const HASH_1 = `0x${'1'.repeat(64)}`;
const HASH_2 = `0x${'2'.repeat(64)}`;
const HASH_3 = `0x${'3'.repeat(64)}`;
const HASH_4 = `0x${'4'.repeat(64)}`;
const WF_1 = `0x${'a'.repeat(64)}`;
const WF_2 = `0x${'b'.repeat(64)}`;
const WF_3 = `0x${'c'.repeat(64)}`;
const WF_4 = `0x${'d'.repeat(64)}`;
const OWNER_1 = '0x1111111111111111111111111111111111111111';
const OWNER_2 = '0x2222222222222222222222222222222222222222';
const OWNER_3 = '0x3333333333333333333333333333333333333333';
const AGENT_1 = '0xaaaa111111111111111111111111111111111111';
const AGENT_2 = '0xbbbb222222222222222222222222222222222222';
const AGENT_3 = '0xcccc333333333333333333333333333333333333';
const VAULT_1 = '0xdddd111111111111111111111111111111111111';
const VAULT_2 = '0xeeee222222222222222222222222222222222222';
const VAULT_3 = '0xffff333333333333333333333333333333333333';

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

it('backfills listing metadata, searches title and description, filters by chain/cross-chain/trigger, and counts confirmed runs', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files) {
      if (file === '0031_marketplace_polish.sql') break;
      await db.exec(await readFile(join(migrationsDir, file), 'utf8'));
    }

    const scheduleProgram = encodeWorkflowV2(
      createWorkflowV2Recipe('recurring-transfer', {
        intervalSeconds: '3600',
        sendUsdc: '5',
        recipient: OWNER_2,
      }),
    );
    const paymentProgram = encodeWorkflowV2(
      createWorkflowV2Recipe(
        'income-sweep',
        {
          minimumPaymentUsdc: '25',
          sendUsdc: '10',
          recipient: OWNER_3,
        },
        { chain: BASE_SEPOLIA_CHAIN_ID, originChain: BASE_SEPOLIA_CHAIN_ID },
      ),
    );
    const crossChainPriceProgram = encodeWorkflowV2({
      chain: BASE_SEPOLIA_CHAIN_ID,
      originChain: UNICHAIN_SEPOLIA_CHAIN_ID,
      trigger: workflowV2Trigger.price,
      interval: 0,
      expires: 0n,
      source: zeroAddress,
      subject: zeroAddress,
      usdcCap: 10_000_000n,
      wethCap: 0n,
      slippage: 100,
      once: false,
      nodes: workflowV2Nodes({
        actions: [
          {
            kind: workflowV2Action.buy,
            unit: workflowV2Unit.fixed,
            amount: 5_000_000n,
            account: zeroAddress,
          },
        ],
      }),
    });
    const transferProgram = encodeWorkflowV2({
      chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      originChain: BASE_SEPOLIA_CHAIN_ID,
      trigger: workflowV2Trigger.transfer,
      interval: 0,
      expires: 0n,
      source: OWNER_1,
      subject: OWNER_2,
      usdcCap: 0n,
      wethCap: 0n,
      slippage: 0,
      once: false,
      nodes: workflowV2Nodes({
        actions: [
          {
            kind: workflowV2Action.alert,
            unit: workflowV2Unit.fixed,
            amount: 0n,
            account: zeroAddress,
          },
        ],
      }),
    });

    const deployment = `5318007:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    await db.query(
      `insert into workflow_v2_market_listings
        (deployment, chain, id, owner, agent, workflow_id, program_hash, program, title, description, visible, block_number, log_index)
       values
        ($1, $2, '1', $3, $4, $5, $6, $7, 'Weekly transfer', 'Automated treasury allocation with 100% cap', true, 100, 0),
        ($1, $8, '2', $9, $10, $11, $12, $13, 'Payroll rule', 'Split incoming USDC_sweep deposits automatically', true, 101, 0),
        ($1, $8, '3', $9, $10, $14, $15, $16, 'Cross-chain watcher', 'Buy WETH on Base when Unichain pool moves', true, 102, 0),
        ($1, $2, '4', $17, $18, $19, $20, $21, 'Bridge alert', 'Watch ERC20 transfer from Base', true, 103, 0),
        ($1, $2, '5', $3, $4, $5, $6, $7, 'Hidden listing', 'Should never appear', false, 104, 0)`,
      [
        deployment,
        UNICHAIN_SEPOLIA_CHAIN_ID,
        OWNER_1,
        AGENT_1,
        WF_1,
        HASH_1,
        scheduleProgram,
        BASE_SEPOLIA_CHAIN_ID,
        OWNER_2,
        AGENT_2,
        WF_2,
        HASH_2,
        paymentProgram,
        WF_3,
        HASH_3,
        crossChainPriceProgram,
        OWNER_3,
        AGENT_3,
        WF_4,
        HASH_4,
        transferProgram,
      ],
    );

    await db.exec(await readFile(join(migrationsDir, '0031_marketplace_polish.sql'), 'utf8'));

    const backfilled = await db.query<{ id: string; origin_chain: number; trigger: number }>(
      `select id, origin_chain, trigger from workflow_v2_market_listings order by id`,
    );
    expect(backfilled.rows).toEqual([
      { id: '1', origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID, trigger: 1 },
      { id: '2', origin_chain: BASE_SEPOLIA_CHAIN_ID, trigger: 2 },
      { id: '3', origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID, trigger: 3 },
      { id: '4', origin_chain: BASE_SEPOLIA_CHAIN_ID, trigger: 4 },
      { id: '5', origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID, trigger: 1 },
    ]);

    // Seed accounts, activations, runs, and outcomes to test verified_runs attribution.
    await db.query(
      `insert into workflow_v2_accounts values
        ($1, $2, $3, $4, $3),
        ($1, $2, $5, $6, $5),
        ($1, $2, $7, $8, $7),
        ($1, $9, $10, $4, $3),
        ($1, $9, $11, $6, $5),
        ($1, $12, $13, $6, $5)`,
      [
        deployment,
        LASNA_CHAIN_ID,
        AGENT_1,
        OWNER_1,
        AGENT_2,
        OWNER_2,
        AGENT_3,
        OWNER_3,
        UNICHAIN_SEPOLIA_CHAIN_ID,
        VAULT_1,
        VAULT_2,
        BASE_SEPOLIA_CHAIN_ID,
        VAULT_3,
      ],
    );
    await db.query(
      `insert into workflow_v2_activations values
        ($1, $2, $3, $4, '1', $5, 'Original'),
        ($1, $2, $6, $7, '1', $5, 'Copier using same program_hash'),
        ($1, $2, $3, $4, '2', $8, 'Original new epoch'),
        ($1, $2, $6, $4, '1', $8, 'Spoofed workflowId from another agent'),
        ($1, $9, $6, $10, '1', $11, 'Base payment')`,
      [
        deployment,
        UNICHAIN_SEPOLIA_CHAIN_ID,
        AGENT_1,
        WF_1,
        HASH_1,
        AGENT_2,
        WF_2,
        `0x${'f'.repeat(64)}`,
        BASE_SEPOLIA_CHAIN_ID,
        WF_2,
        HASH_2,
      ],
    );
    await db.query(
      `insert into workflow_v2_runs values
        -- Matches listing 1 via both (agent, workflow_id) and program_hash -> must count ONCE
        ($1, $2, 'run-1', $3, $4, $5, '1', $2, $5, '0', $5, 200, 1),
        -- Matches listing 1 via copier program_hash -> counts
        ($1, $2, 'run-2', $6, $7, $5, '1', $2, $5, '1', $5, 201, 1),
        -- Matches listing 1 via original (agent, workflow_id) on updated epoch -> counts
        ($1, $2, 'run-3', $3, $4, $8, '2', $2, $5, '2', $5, 202, 1),
        -- Failed run for listing 1 -> excluded
        ($1, $2, 'run-4', $3, $4, $5, '1', $2, $5, '3', $5, 203, 1),
        -- Pending run for listing 1 -> excluded
        ($1, $2, 'run-5', $3, $4, $5, '1', $2, $5, '4', $5, 204, 9999999999),
        -- Spoofed workflow_id from AGENT_2 with different program_hash -> excluded
        ($1, $2, 'run-6', $6, $4, $8, '1', $2, $5, '5', $5, 205, 1),
        -- Confirmed run for listing 2 on Base Sepolia -> counts on listing 2
        ($1, $9, 'run-7', $6, $7, $10, '1', $9, $10, '0', $10, 206, 1)`,
      [
        deployment,
        UNICHAIN_SEPOLIA_CHAIN_ID,
        AGENT_1,
        WF_1,
        HASH_1,
        AGENT_2,
        WF_2,
        `0x${'f'.repeat(64)}`,
        BASE_SEPOLIA_CHAIN_ID,
        HASH_2,
      ],
    );
    await db.query(
      `insert into workflow_v2_outcomes values
        ($1, $2, 'run-1', $3, $4, '1', 'tx-1', 10, 0, 1, '0x00000000', 0),
        ($1, $2, 'run-2', $5, $6, '1', 'tx-2', 11, 0, 1, '0x00000000', 0),
        ($1, $2, 'run-3', $3, $4, '2', 'tx-3', 12, 0, 1, '0x00000000', 0),
        ($1, $2, 'run-4', $3, $4, '1', 'tx-4', 13, 0, 4, '0x12345678', null),
        ($1, $2, 'run-6', $3, $6, '1', 'tx-6', 14, 0, 1, '0x00000000', 0),
        ($1, $7, 'run-7', $5, $8, '1', 'tx-7', 15, 0, 1, '0x00000000', 0)`,
      [
        deployment,
        UNICHAIN_SEPOLIA_CHAIN_ID,
        WF_1,
        VAULT_1,
        WF_2,
        VAULT_2,
        BASE_SEPOLIA_CHAIN_ID,
        VAULT_3,
      ],
    );

    const all = await db.query<{ id: string; verified_runs: number }>(
      `select id, verified_runs from workflow_v2_marketplace_browse($1, $2)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]],
    );
    expect(all.rows).toEqual([
      { id: '4', verified_runs: 0 },
      { id: '3', verified_runs: 0 },
      { id: '2', verified_runs: 1 },
      { id: '1', verified_runs: 3 },
    ]);

    // Description-only search + literal wildcard escaping (% and _).
    const descMatch = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_browse($1, $2, $3)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID], 'treasury'],
    );
    expect(descMatch.rows).toEqual([{ id: '1' }]);

    const literalPercent = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_browse($1, $2, $3)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID], '100%'],
    );
    expect(literalPercent.rows).toEqual([{ id: '1' }]);

    const literalUnderscore = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_browse($1, $2, $3)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID], 'USDC_sweep'],
    );
    expect(literalUnderscore.rows).toEqual([{ id: '2' }]);

    // Cross-chain + chain + trigger filters.
    const crossOnly = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_browse($1, $2, null, true, null)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]],
    );
    expect(crossOnly.rows).toEqual([{ id: '4' }, { id: '3' }]);

    const baseCrossPrice = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_browse($1, $2, null, true, 3::smallint)`,
      [deployment, [BASE_SEPOLIA_CHAIN_ID]],
    );
    expect(baseCrossPrice.rows).toEqual([{ id: '3' }]);

    // Cursor pagination keeps search and filter constraints intact.
    const page1 = await db.query<{ id: string; block_number: string; log_index: number }>(
      `select id, block_number, log_index from workflow_v2_marketplace_browse($1, $2, null, null, null, null, null, 2)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]],
    );
    expect(page1.rows.map((r) => r.id)).toEqual(['4', '3']);
    const page2 = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_browse($1, $2, null, null, null, $3, $4, 2)`,
      [
        deployment,
        [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
        Number(page1.rows[1]!.block_number),
        page1.rows[1]!.log_index,
      ],
    );
    expect(page2.rows.map((r) => r.id)).toEqual(['2', '1']);

    // Single listing lookup returns verified_runs and excludes hidden listings.
    const single = await db.query<{
      id: string;
      verified_runs: number;
      origin_chain: number;
      trigger: number;
    }>(
      `select id, verified_runs, origin_chain, trigger from workflow_v2_marketplace_listing($1, '1', $2)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]],
    );
    expect(single.rows).toEqual([
      { id: '1', verified_runs: 3, origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID, trigger: 1 },
    ]);
    const hidden = await db.query(`select id from workflow_v2_marketplace_listing($1, '5', $2)`, [
      deployment,
      [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
    ]);
    expect(hidden.rows).toEqual([]);

    // Non-ABI hex falls back to origin_chain = chain and trigger = null; backslash search is literal.
    await db.query(
      `insert into workflow_v2_market_listings
        (deployment, chain, id, owner, agent, workflow_id, program_hash, program, title, description, visible, block_number, log_index)
       values
        ($1, $2, '6', $3, $4, $5, $6, '0xdeadbeef', 'Legacy raw', 'Contains a literal \\\\ slash', true, 105, 0)`,
      [deployment, UNICHAIN_SEPOLIA_CHAIN_ID, OWNER_1, AGENT_1, WF_1, HASH_1],
    );
    await db.exec(`
      update workflow_v2_market_listings
      set origin_chain = chain
      where id = '6' and origin_chain is null;
    `);
    const legacy = await db.query<{ id: string; origin_chain: number; trigger: number | null }>(
      `select id, origin_chain, trigger from workflow_v2_marketplace_listing($1, '6', $2)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID]],
    );
    expect(legacy.rows).toEqual([
      { id: '6', origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID, trigger: null },
    ]);

    const backslashMatch = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_browse($1, $2, $3)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID], '\\'],
    );
    expect(backslashMatch.rows).toEqual([{ id: '6' }]);

    // Cursor pagination preserves active search and filter constraints.
    const filteredPage1 = await db.query<{ id: string; block_number: string; log_index: number }>(
      `select id, block_number, log_index from workflow_v2_marketplace_browse($1, $2, 'Base', true, null, null, null, 1)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]],
    );
    expect(filteredPage1.rows.map((r) => r.id)).toEqual(['4']);
    const filteredPage2 = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_browse($1, $2, 'Base', true, null, $3, $4, 1)`,
      [
        deployment,
        [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
        Number(filteredPage1.rows[0]!.block_number),
        filteredPage1.rows[0]!.log_index,
      ],
    );
    expect(filteredPage2.rows.map((r) => r.id)).toEqual(['3']);

    // Role permissions: anon and authenticated are denied; service_role is allowed.
    for (const role of ['anon', 'authenticated'] as const) {
      await db.exec('begin');
      await db.exec(`set local role ${role}`);
      await expect(
        db.query(`select * from workflow_v2_marketplace_browse($1, $2)`, [
          deployment,
          [UNICHAIN_SEPOLIA_CHAIN_ID],
        ]),
      ).rejects.toThrow(/permission denied/i);
      await db.exec('rollback');
    }
    await db.exec(`
      grant select on workflow_v2_market_listings, workflow_v2_activity,
        workflow_v2_runs, workflow_v2_accounts, workflow_v2_activations, workflow_v2_outcomes
        to service_role;
      alter role service_role bypassrls;
    `);
    await db.exec('begin');
    await db.exec('set local role service_role');
    const roleAllowed = await db.query<{ id: string }>(
      `select id from workflow_v2_marketplace_listing($1, '1', $2)`,
      [deployment, [UNICHAIN_SEPOLIA_CHAIN_ID]],
    );
    await db.exec('commit');
    expect(roleAllowed.rows).toEqual([{ id: '1' }]);
  } finally {
    await db.close();
  }
});
