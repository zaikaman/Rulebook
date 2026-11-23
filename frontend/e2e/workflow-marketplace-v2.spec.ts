import { expect, test } from '@playwright/test';
import {
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowVaultFactoryV2Abi,
} from '@rulebook/shared';
import {
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  publicActions,
  toHex,
  zeroAddress,
} from 'viem';
import { unichainSepolia } from 'viem/chains';

import {
  ANVIL_RPC_URL,
  FIXTURE_API_URL,
  FIXTURE_FRONTEND_URL,
  SPONSOR_ADDRESS,
  WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
  WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
} from './fixtureConfig';

test('opens a newly published listing while indexing catches up', async ({ page, context }) => {
  const chain = createWalletClient({
    account: SPONSOR_ADDRESS,
    chain: unichainSepolia,
    transport: http(ANVIL_RPC_URL),
  }).extend(publicActions);
  const factory = { address: WORKFLOW_V2_AGENT_FACTORY_ADDRESS, abi: workflowAgentFactoryV2Abi };
  const createAgent = await chain.writeContract({ ...factory, functionName: 'create' });
  await chain.waitForTransactionReceipt({ hash: createAgent });
  const agent = await chain.readContract({
    ...factory,
    functionName: 'agentOf',
    args: [SPONSOR_ADDRESS],
  });
  const account = { address: agent, abi: workflowAgentV2Abi };
  const linked = await chain.readContract({
    ...account,
    functionName: 'vaults',
    args: [UNICHAIN_SEPOLIA_CHAIN_ID],
  });
  if (linked === zeroAddress) {
    const vaultFactory = {
      address: WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
      abi: workflowVaultFactoryV2Abi,
    };
    const createVault = await chain.writeContract({
      ...vaultFactory,
      functionName: 'create',
      args: [agent],
    });
    await chain.waitForTransactionReceipt({ hash: createVault });
    const vault = await chain.readContract({
      ...vaultFactory,
      functionName: 'vaultOf',
      args: [SPONSOR_ADDRESS],
    });
    const link = await chain.writeContract({
      ...account,
      functionName: 'linkVault',
      args: [UNICHAIN_SEPOLIA_CHAIN_ID, vault],
    });
    await chain.waitForTransactionReceipt({ hash: link });
  }

  const title = 'Recurring test transfer';
  const description = 'Send a fixed amount of test USDC on a schedule.';
  const workflow = keccak256(toHex(`marketplace-indexing-${await chain.getBlockNumber()}`));
  const program = encodeWorkflowV2(
    createWorkflowV2Recipe('recurring-transfer', {
      intervalSeconds: '3600',
      sendUsdc: '0.02',
      recipient: SPONSOR_ADDRESS,
    }),
  );
  const enable = await chain.writeContract({
    ...account,
    functionName: 'enable',
    args: [workflow, 1n, program, title, 1n],
  });
  await chain.waitForTransactionReceipt({ hash: enable });
  const publish = await chain.writeContract({
    ...factory,
    functionName: 'publish',
    args: [workflow, description],
  });
  const { logs } = await chain.waitForTransactionReceipt({ hash: publish });
  const [event] = parseEventLogs({ abi: factory.abi, eventName: 'Published', logs });
  expect(event).toBeDefined();
  const published = event!.args;
  const id = published.listing.toString();
  const api = `${FIXTURE_API_URL}/v3/marketplace/${id}`;

  // The fixture index starts empty. Release the row derived from the real publish event
  // after both routes have observed the production API's 404.
  let indexed = false;
  await context.route(api, async (route) => {
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
        program,
      },
    });
  });

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
  await expect(page.getByRole('link', { name: 'Copy as draft' })).toBeVisible();

  // The indexed row can outlive an unpublish. Lasna still controls public visibility.
  const unpublish = await chain.writeContract({
    ...factory,
    functionName: 'unpublish',
    args: [published.listing],
  });
  await chain.waitForTransactionReceipt({ hash: unpublish });
  await page.evaluate((key) => localStorage.removeItem(key), `rulebook-v2-draft:${id}`);
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
