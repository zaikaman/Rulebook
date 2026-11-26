import { expect, test } from '@playwright/test';
import { getChain, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import {
  createTestClient,
  http,
  parseAbi,
  publicActions,
  toFunctionSelector,
  walletActions,
} from 'viem';

import { ANVIL_RPC_URL, FIXTURE_FRONTEND_URL } from './fixtureConfig';
import { installWallet, walletRequests } from './wallet';

const OWNER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

test('guides a new wallet from the landing page through V2 setup and funding', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 760 });
  await installWallet(page, OWNER, UNICHAIN_SEPOLIA_CHAIN_ID, {
    rejectFirstCall: toFunctionSelector('linkVault(uint32,address)'),
  });
  const chain = createTestClient({ mode: 'anvil', transport: http(ANVIL_RPC_URL) })
    .extend(publicActions)
    .extend(walletActions);
  const balance = await chain.getBalance({ address: OWNER });
  const token = getChain(UNICHAIN_SEPOLIA_CHAIN_ID).usdc;
  const mint = await chain.writeContract({
    address: token,
    abi: parseAbi(['function mint(address to, uint256 amount)']),
    functionName: 'mint',
    args: [OWNER, 10_000_000n],
    account: OWNER,
    chain: null,
  });
  await chain.waitForTransactionReceipt({ hash: mint });

  await page.goto(FIXTURE_FRONTEND_URL);
  await page.getByRole('link', { name: 'Build a workflow' }).first().click();
  await expect(page.getByRole('heading', { name: 'Connect your wallet' })).toBeVisible();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);

  await chain.setBalance({ address: OWNER, value: 0n });
  try {
    await page.getByRole('button', { name: 'Connect wallet to start' }).click();
    await expect(page.getByRole('heading', { name: 'Get test tokens' })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Get Lasna REACT' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get Unichain Sepolia ETH' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create my account' })).toHaveCount(0);
    expect(await walletRequests(page)).toEqual([]);
  } finally {
    await chain.setBalance({ address: OWNER, value: balance });
  }
  await page.getByRole('button', { name: 'Check balances' }).click();

  const review = page.getByRole('region', { name: 'Wallet steps' });
  await expect(review.getByRole('listitem')).toHaveCount(3);
  await expect(review.getByRole('listitem').nth(1)).toContainText('Create your vault');
  await expect(review.getByText('2 approvals', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('alert')).toContainText('Wallet request cancelled.');
  await expect(review.getByRole('listitem')).toHaveCount(1);
  await expect(review.getByRole('listitem')).toContainText(
    'Link your automation account and vault',
  );

  await page.getByRole('link', { name: 'Manage vault funds' }).click();
  await expect(page.getByRole('heading', { name: 'Move test funds' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to account', exact: true }).click();
  await expect(review.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Continue account setup' }).click();
  await expect(page.getByRole('heading', { name: 'Fund your account' })).toBeFocused();
  await expect(page.getByText('Step 5 of 5')).toBeVisible();
  await expect(page.getByLabel('Watching credit (lREACT)')).toHaveValue('0.1');
  await expect(page.getByLabel('Execution credit (ETH)')).toHaveValue('0.001');
  await expect(page.getByLabel('Vault USDC (USDC)')).toHaveValue('10');

  await page.getByRole('button', { name: 'Deposit funds' }).click();
  await expect(page.getByRole('button', { name: 'Open Account & Vault' })).toBeVisible({
    timeout: 60_000,
  });
  expect(
    (await walletRequests(page))
      .filter(({ method }) => method === 'eth_sendTransaction')
      .map(({ chainId }) => chainId),
  ).toEqual([
    LASNA_CHAIN_ID,
    UNICHAIN_SEPOLIA_CHAIN_ID,
    LASNA_CHAIN_ID,
    LASNA_CHAIN_ID,
    LASNA_CHAIN_ID,
    UNICHAIN_SEPOLIA_CHAIN_ID,
    UNICHAIN_SEPOLIA_CHAIN_ID,
  ]);

  await page.getByRole('button', { name: 'Open Account & Vault' }).click();
  await expect(page.getByRole('heading', { name: 'Account & Vault' })).toBeVisible();
  await expect(page.locator('.rb-balance').filter({ hasText: 'Vault USDC' })).toContainText(
    /10\s*USDC/,
  );
  await expect(page.locator('.rb-balance').filter({ hasText: 'Execution credit' })).toContainText(
    /0\.001\s*ETH/,
  );
  await expect(page.locator('.rb-credit-row').filter({ hasText: 'Watching credit' })).toContainText(
    /0\.1\s*lREACT/,
  );

  await page.getByRole('link', { name: 'New workflow' }).click();
  await expect(page).toHaveURL(FIXTURE_FRONTEND_URL + '/workflows/new');
  await expect(page.getByRole('region', { name: 'Workflow recipes' })).toBeVisible();
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible();
  await expect(page.getByText(/Step \d of 5/)).toHaveCount(0);
});
