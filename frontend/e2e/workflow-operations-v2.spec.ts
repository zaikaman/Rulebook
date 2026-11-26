import { expect, test } from '@playwright/test';
import {
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type WorkflowV2RunProof,
} from '@rulebook/shared';

import { ANVIL_RPC_URL, FIXTURE_FRONTEND_URL, USER_ADDRESS } from './fixtureConfig';
import { approveSignature, fundFixtureWorkflowVault, installWallet } from './wallet';

const owner = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const title = 'Recurring transfer';

test('warns about low credits and opens the right funding action and workflow Activity', async ({
  page,
}) => {
  await installWallet(page, owner);
  await page.goto(FIXTURE_FRONTEND_URL + '/create');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('region', { name: 'Workflow recipes' })).toBeVisible();
  await fundFixtureWorkflowVault(owner, 10_000_000n);
  await page.goto(FIXTURE_FRONTEND_URL + '/account?credit=execution');
  await expect(page.getByLabel('Funding action')).toContainText('Deposit ETH for execution credit');
  await page.getByRole('link', { name: 'New workflow' }).click();
  await expect(page.getByRole('region', { name: 'Workflow recipes' })).toBeVisible();
  await page.getByRole('button', { name: title, exact: false }).click();
  await page.getByLabel('Interval in seconds').fill('3600');
  await page.getByLabel('USDC to send').fill('0.02');
  await page.getByLabel('Recipient address').fill(USER_ADDRESS);
  await page.getByRole('button', { name: 'Open in builder' }).click();
  await page.getByRole('button', { name: 'Review workflow' }).click();

  const credit = page.getByRole('region', { name: 'Workflow fee credit' });
  await expect(credit.getByText('Watching credit · Low', { exact: true })).toBeVisible();
  await expect(credit.getByText('Execution credit · Low', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activate workflow' }).click();
  const switchNetwork = page.getByRole('dialog', { name: 'Switch to Unichain Sepolia' });
  await expect(
    switchNetwork.or(page.getByRole('dialog', { name: 'Review signature on Unichain Sepolia' })),
  ).toBeVisible();
  await approveSignature(page, 'Unichain Sepolia', {
    switchNetwork: await switchNetwork.isVisible(),
  });
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await expect(page.getByRole('link', { name: 'Edit workflow' })).toBeVisible();
  const health = page.getByRole('region', { name: 'Workflow health' });
  await expect(health).toContainText('Blocked by low execution credit');
  await expect(health).toContainText('No successful run yet');
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const workflowActivity = page
    .locator('main')
    .getByRole('link', { name: 'Activity', exact: true });
  await expect(workflowActivity).toHaveAttribute('href', `/activity?workflow=${id}`);
  const filtered = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/v3/activity' && url.searchParams.get('workflow') === id;
  });
  await workflowActivity.click();
  await filtered;
  await expect(page.getByRole('heading', { name: 'Workflow activity' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All activity', exact: true })).toBeVisible();

  await page.goBack();
  await credit.getByRole('link', { name: 'Add execution credit' }).click();
  await expect(page.getByLabel('Funding action')).toContainText('Deposit ETH for execution credit');
  await expect(page.getByLabel('Amount (ETH)')).toBeFocused();
});

test('finds a public workflow proof from workspace costs without connecting a wallet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const run: WorkflowV2RunProof = {
    id: `0x${'1'.repeat(64)}`,
    chain: UNICHAIN_SEPOLIA_CHAIN_ID,
    programHash: `0x${'2'.repeat(64)}`,
    originChain: LASNA_CHAIN_ID,
    originTransaction: `0x${'3'.repeat(64)}`,
    originLogIndex: '17',
    lasnaTransaction: `0x${'4'.repeat(64)}`,
    destinationTransaction: `0x${'5'.repeat(64)}`,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    status: 'confirmed',
    path: 2,
    reason: null,
  };
  await page.route(
    (url) => url.pathname === `/v3/runs/${run.id}`,
    async (route) => {
      expect(route.request().headers().authorization).toBeUndefined();
      await route.fulfill({ json: run });
    },
  );
  await page.route(ANVIL_RPC_URL, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const rpc = route.request().postDataJSON();
    if (rpc.method !== 'eth_getTransactionReceipt') return route.fallback();
    const hash = rpc.params[0];
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          transactionHash: hash,
          status: '0x1',
          gasUsed: '0x5208',
          ...(hash === run.destinationTransaction ? { effectiveGasPrice: '0x3b9aca00' } : {}),
        },
      },
    });
  });

  await page.goto(FIXTURE_FRONTEND_URL + '/workflows');
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: 'Costs' })
    .click();
  await expect(page.getByRole('heading', { name: 'Workflow costs' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Watching credit' })).toContainText('gwei');
  await expect(
    page.getByRole('region', { name: 'Execution credit (Unichain Sepolia)' }),
  ).toContainText('gwei');
  await expect(page.getByRole('region', { name: 'Execution credit (Base Sepolia)' })).toContainText(
    'gwei',
  );
  await page.getByRole('link', { name: 'Open workflow proof' }).click();
  await page.getByLabel('Run ID').fill(run.id);
  await page.getByRole('button', { name: 'Open proof' }).click();
  await expect(page).toHaveURL(`${FIXTURE_FRONTEND_URL}/runs/${run.id}`);
  await expect(page.getByRole('heading', { name: 'Workflow run proof' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Run outcome' })).toContainText('confirmed');
  await expect(page.getByRole('region', { name: 'Run outcome' })).toContainText('Path 3');
  await expect(page.getByRole('button', { name: 'Copy proof link' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open run in Activity' })).toHaveAttribute(
    'href',
    `/activity?run=${run.id}`,
  );
  await expect(page.getByRole('list', { name: 'Run transactions' })).toContainText('Log index 17');
  await expect(page.getByRole('link', { name: run.lasnaTransaction })).toHaveAttribute(
    'href',
    new RegExp(`/tx/${run.lasnaTransaction}$`),
  );
  const transactions = page.getByRole('list', { name: 'Run transactions' });
  await expect(transactions.getByText('Transaction execution gas unavailable.')).toHaveCount(2);
  await expect(transactions.getByText('Transaction execution gas 0.000021 ETH')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet to start' })).toHaveCount(0);
  expect(await page.locator('main').evaluate((main) => main.scrollWidth)).toBeLessThanOrEqual(390);
});
