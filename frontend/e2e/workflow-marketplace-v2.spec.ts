import { expect, test } from '@playwright/test';
import {
  BASE_SEPOLIA_CHAIN_ID,
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowV2Action,
  workflowV2Nodes,
  workflowV2Trigger,
  workflowV2Unit,
  workflowVaultFactoryV2Abi,
} from '@rulebook/shared';
import {
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEventLogs,
  publicActions,
  toHex,
  zeroAddress,
} from 'viem';
import { unichainSepolia } from 'viem/chains';

import {
  ANVIL_LASNA_RPC_URL,
  ANVIL_RPC_URL,
  FIXTURE_API_URL,
  FIXTURE_FRONTEND_URL,
  SPONSOR_ADDRESS,
  WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
  WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
} from './fixtureConfig';

const lasnaAnvil = defineChain({
  id: LASNA_CHAIN_ID,
  name: 'Reactive Lasna',
  nativeCurrency: { name: 'Lasna REACT', symbol: 'lREACT', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_LASNA_RPC_URL] } },
  testnet: true,
});

test('opens a newly published listing while indexing catches up', async ({ page, context }) => {
  const lasnaChain = createWalletClient({
    account: SPONSOR_ADDRESS,
    chain: lasnaAnvil,
    transport: http(ANVIL_LASNA_RPC_URL),
  }).extend(publicActions);
  const unichain = createWalletClient({
    account: SPONSOR_ADDRESS,
    chain: unichainSepolia,
    transport: http(ANVIL_RPC_URL),
  }).extend(publicActions);
  const factory = { address: WORKFLOW_V2_AGENT_FACTORY_ADDRESS, abi: workflowAgentFactoryV2Abi };
  const createAgent = await lasnaChain.writeContract({ ...factory, functionName: 'create' });
  await lasnaChain.waitForTransactionReceipt({ hash: createAgent });
  const agent = await lasnaChain.readContract({
    ...factory,
    functionName: 'agentOf',
    args: [SPONSOR_ADDRESS],
  });
  const account = { address: agent, abi: workflowAgentV2Abi };
  const linked = await lasnaChain.readContract({
    ...account,
    functionName: 'vaults',
    args: [UNICHAIN_SEPOLIA_CHAIN_ID],
  });
  if (linked === zeroAddress) {
    const vaultFactory = {
      address: WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
      abi: workflowVaultFactoryV2Abi,
    };
    const createVault = await unichain.writeContract({
      ...vaultFactory,
      functionName: 'create',
      args: [agent],
    });
    await unichain.waitForTransactionReceipt({ hash: createVault });
    const vault = await unichain.readContract({
      ...vaultFactory,
      functionName: 'vaultOf',
      args: [SPONSOR_ADDRESS],
    });
    const link = await lasnaChain.writeContract({
      ...account,
      functionName: 'linkVault',
      args: [UNICHAIN_SEPOLIA_CHAIN_ID, vault],
    });
    await lasnaChain.waitForTransactionReceipt({ hash: link });
  }

  const title = 'Recurring test transfer';
  const description = 'Send a fixed amount of test USDC on a schedule.';
  const workflow = keccak256(toHex(`marketplace-indexing-${await lasnaChain.getBlockNumber()}`));
  const program = encodeWorkflowV2(
    createWorkflowV2Recipe('recurring-transfer', {
      intervalSeconds: '3600',
      sendUsdc: '0.02',
      recipient: SPONSOR_ADDRESS,
    }),
  );
  const enable = await lasnaChain.writeContract({
    ...account,
    functionName: 'enable',
    args: [workflow, 1n, program, title, 1n],
  });
  await lasnaChain.waitForTransactionReceipt({ hash: enable });
  const publish = await lasnaChain.writeContract({
    ...factory,
    functionName: 'publish',
    args: [workflow, description],
  });
  const { logs } = await lasnaChain.waitForTransactionReceipt({ hash: publish });
  const [event] = parseEventLogs({ abi: factory.abi, eventName: 'Published', logs });
  expect(event).toBeDefined();
  const published = event!.args;
  const id = published.listing.toString();

  // The fixture index starts empty. Release the row derived from the real publish event
  // after both routes have observed the production API's 404.
  let indexed = false;
  await context.route(
    (url) =>
      url.origin === new URL(FIXTURE_API_URL).origin && url.pathname === `/v3/marketplace/${id}`,
    async (route) => {
      if (!indexed) return route.continue();
      await route.fulfill({
        headers: { 'access-control-allow-origin': FIXTURE_FRONTEND_URL },
        json: {
          id,
          title: published.title,
          description: published.description,
          owner: published.owner,
          agent: published.agent,
          workflow_id: published.workflow,
          program_hash: published.programHash,
          chain: published.chain,
          origin_chain: published.chain,
          trigger: 1,
          program,
          verified_runs: 2,
        },
      });
    },
  );

  const detail = `${FIXTURE_FRONTEND_URL}/marketplace/${id}`;
  await page.goto(detail);
  await expect(page.getByRole('status')).toContainText('Syncing listing');
  await expect(page.getByRole('link', { name: 'Copy as draft' })).toHaveCount(0);
  const copy = await context.newPage();
  await copy.setViewportSize({ width: 390, height: 844 });
  await copy.goto(`${FIXTURE_FRONTEND_URL}/workflows/new?copy=${id}`);
  await expect(copy.getByRole('status')).toContainText('Syncing listing');
  await expect(copy.getByLabel('Workflow name')).toHaveCount(0);

  indexed = true;
  await expect(copy.getByLabel('Workflow name')).toHaveValue(title, { timeout: 15_000 });
  await copy.close();
  await page.bringToFront();
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(description)).toBeVisible();
  await expect(page.getByText('2 verified runs')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Copy as draft' })).toBeVisible();

  // The indexed row can outlive an unpublish. Lasna still controls public visibility.
  const unpublish = await lasnaChain.writeContract({
    ...factory,
    functionName: 'unpublish',
    args: [published.listing],
  });
  await lasnaChain.waitForTransactionReceipt({ hash: unpublish });
  await page.evaluate((key) => localStorage.removeItem(key), `rulebook-v2-draft:testnet:${id}`);
  await page.getByRole('link', { name: 'Copy as draft' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'This listing is no longer public or does not exist.',
  );
  await expect(page.getByLabel('Workflow name')).toHaveCount(0);

  await page.goto(detail);
  await expect(page.getByRole('alert')).toContainText(
    'This listing is no longer public or does not exist.',
  );
  await expect(page.getByRole('link', { name: 'Copy as draft' })).toHaveCount(0);

  await page.goto(`${FIXTURE_FRONTEND_URL}/marketplace/${published.listing + 1n}`);
  await expect(page.getByRole('alert')).toContainText(
    'This listing is no longer public or does not exist.',
  );
  await expect(page.getByRole('status').filter({ hasText: 'Syncing listing' })).toHaveCount(0);
});

test('searches description, filters by network, cross-chain, and trigger chips, and renders verified run counts at desktop and mobile', async ({
  page,
}, testInfo) => {
  const scheduleProgram = encodeWorkflowV2(
    createWorkflowV2Recipe('recurring-transfer', {
      intervalSeconds: '3600',
      sendUsdc: '5',
      recipient: SPONSOR_ADDRESS,
    }),
  );
  const crossChainProgram = encodeWorkflowV2({
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
  const paymentProgram = encodeWorkflowV2(
    createWorkflowV2Recipe(
      'income-sweep',
      {
        minimumPaymentUsdc: '25',
        sendUsdc: '10',
        recipient: SPONSOR_ADDRESS,
      },
      { chain: BASE_SEPOLIA_CHAIN_ID, originChain: BASE_SEPOLIA_CHAIN_ID },
    ),
  );

  const listings = [
    {
      id: '101',
      title: 'Treasury payout',
      description: 'Routes scheduled USDC transfers every hour.',
      owner: SPONSOR_ADDRESS,
      agent: SPONSOR_ADDRESS,
      workflow_id: keccak256(toHex('wf-101')),
      program_hash: keccak256(scheduleProgram),
      chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      trigger: 1,
      program: scheduleProgram,
      verified_runs: 14,
    },
    {
      id: '102',
      title: 'Dip accumulator',
      description: 'Watches Unichain Sepolia pool price and settles on Base Sepolia.',
      owner: SPONSOR_ADDRESS,
      agent: SPONSOR_ADDRESS,
      workflow_id: keccak256(toHex('wf-102')),
      program_hash: keccak256(crossChainProgram),
      chain: BASE_SEPOLIA_CHAIN_ID,
      origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      trigger: 3,
      program: crossChainProgram,
      verified_runs: 3,
    },
    {
      id: '103',
      title: 'Income split',
      description: 'Forwards part of each incoming Base Sepolia payment.',
      owner: SPONSOR_ADDRESS,
      agent: SPONSOR_ADDRESS,
      workflow_id: keccak256(toHex('wf-103')),
      program_hash: keccak256(paymentProgram),
      chain: BASE_SEPOLIA_CHAIN_ID,
      origin_chain: BASE_SEPOLIA_CHAIN_ID,
      trigger: 2,
      program: paymentProgram,
      verified_runs: 0,
    },
  ];

  const triggerMap: Record<string, number> = {
    schedule: 1,
    payment: 2,
    price: 3,
    transfer: 4,
  };

  await page.route(
    (url) => url.origin === new URL(FIXTURE_API_URL).origin && url.pathname === '/v3/marketplace',
    async (route) => {
      const url = new URL(route.request().url());
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const chain = url.searchParams.get('chain');
      const crossChain = url.searchParams.get('crossChain');
      const trigger = url.searchParams.get('trigger');
      const filtered = listings.filter((item) => {
        if (
          q &&
          !item.title.toLowerCase().includes(q) &&
          !item.description.toLowerCase().includes(q)
        ) {
          return false;
        }
        if (chain && String(item.chain) !== chain) return false;
        if (crossChain === 'true' && item.origin_chain === item.chain) return false;
        if (crossChain === 'false' && item.origin_chain !== item.chain) return false;
        if (trigger && item.trigger !== triggerMap[trigger]) return false;
        return true;
      });
      await route.fulfill({
        headers: { 'access-control-allow-origin': FIXTURE_FRONTEND_URL },
        json: { listings: filtered, nextCursor: null },
      });
    },
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/marketplace`);
  await expect(page.getByText('Treasury payout')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('14 verified runs')).toBeVisible();
  await expect(page.getByText('3 verified runs')).toBeVisible();
  await expect(page.getByText('0 verified runs')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Dip accumulator/ }).getByText('Cross-chain', { exact: true }),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath('marketplace-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });

  // Search by description-only keyword.
  await page.getByRole('searchbox', { name: 'Search listings' }).fill('incoming');
  await expect(page.getByText('Income split')).toBeVisible();
  await expect(page.getByText('Treasury payout')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByText('Treasury payout')).toBeVisible();

  // Filter by Network + Cross-chain + Trigger.
  await page
    .getByRole('group', { name: 'Network', exact: true })
    .getByRole('button', { name: 'Base Sepolia' })
    .click();
  await page
    .getByRole('group', { name: 'Routing' })
    .getByRole('button', { name: 'Cross-chain' })
    .click();
  await page
    .getByRole('group', { name: 'Trigger' })
    .getByRole('button', { name: 'Pool price' })
    .click();
  await expect(page.getByText('Dip accumulator')).toBeVisible();
  await expect(page.getByText('Income split')).toHaveCount(0);

  // Conflicting trigger shows empty state and resets cleanly.
  await page
    .getByRole('group', { name: 'Trigger' })
    .getByRole('button', { name: 'Token transfer' })
    .click();
  await expect(page.getByText('No listings match your filters')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).first().click();
  await expect(page.getByText('Treasury payout')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('group', { name: 'Network', exact: true })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath('marketplace-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
