import { expect, test } from '@playwright/test';
import {
  BASE_SEPOLIA_CHAIN_ID,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from '@rulebook/shared';
import { createTestClient, http, parseAbi, publicActions, walletActions } from 'viem';

import { ANVIL_BASE_RPC_URL, FIXTURE_FRONTEND_URL } from './fixtureConfig';
import { approveSignature, installWallet, walletRequests } from './wallet';

const OWNER = '0x976EA74026E726554dB657fA54763abd0C3a0aa9' as const;
const BASE_ONBOARD_OWNER = '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f' as const;

test('supports deploying a Base Sepolia Vault and selecting Base Sepolia or cross-chain triggers', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installWallet(page, OWNER, UNICHAIN_SEPOLIA_CHAIN_ID);

  // Open Account & Vault and connect the injected wallet.
  await page.goto(`${FIXTURE_FRONTEND_URL}/account`);
  const connectButton = page.getByRole('button', { name: 'Connect wallet to start' });
  await expect(connectButton).toBeVisible({ timeout: 30_000 });
  await connectButton.click();

  const createButton = page.getByRole('button', { name: 'Create my account' });
  const continueButton = page.getByRole('button', { name: 'Continue account setup' });
  const vaultHeading = page.getByRole('heading', { name: 'Contracts' });
  await expect(createButton.or(continueButton).or(vaultHeading)).toBeVisible({ timeout: 30_000 });

  if (await createButton.isVisible()) {
    await createButton.click();
  } else if (await continueButton.isVisible()) {
    await continueButton.click();
  }

  const skipFunding = page.getByRole('button', { name: 'Skip for now' });
  await expect(skipFunding.or(vaultHeading)).toBeVisible({ timeout: 60_000 });
  if (await skipFunding.isVisible()) {
    await skipFunding.click();
  }

  await expect(vaultHeading).toBeVisible({ timeout: 60_000 });

  // Switch Account & Vault network selector to Base Sepolia and deploy + link Base Sepolia Vault.
  await page
    .getByRole('combobox')
    .filter({ hasText: /Unichain Sepolia/i })
    .first()
    .click();
  await page.getByRole('option', { name: 'Base Sepolia' }).click();

  const createBaseVault = page.getByRole('button', { name: 'Create & link Base Sepolia Vault' });
  await expect(createBaseVault).toBeVisible({ timeout: 30_000 });
  await createBaseVault.click();
  await approveSignature(page, 'Base Sepolia', { switchNetwork: true });
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });

  await expect(page.getByText('Base Sepolia Vault', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const signedChains = (await walletRequests(page))
    .filter(({ method }) => method === 'eth_sendTransaction')
    .map(({ chainId }) => chainId);
  expect(signedChains).toContain(BASE_SEPOLIA_CHAIN_ID);
  expect(signedChains).toContain(LASNA_CHAIN_ID);

  // Open Workflow Builder, switch Settlement network to Base Sepolia, and pick a cross-chain trigger.
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);
  await expect(page.getByRole('region', { name: 'Workflow recipes' })).toBeVisible();
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible();

  await page
    .getByRole('combobox')
    .filter({ hasText: /Unichain Sepolia/i })
    .first()
    .click();
  await page.getByRole('option', { name: 'Base Sepolia' }).click();

  // Select Trigger node and verify cross-chain Trigger network selector appears for Pool price.
  await page.locator('.react-flow__node').first().click();
  const triggerType = page.locator('select.app-input').first();
  await expect(triggerType).toBeVisible();
  await triggerType.selectOption('3');
  const originTriggerSelect = page
    .getByRole('combobox')
    .filter({ hasText: /Base Sepolia/i })
    .last();
  await expect(originTriggerSelect).toBeVisible();
  await originTriggerSelect.click();
  await page.getByRole('option', { name: 'Unichain Sepolia' }).click();

  // Verify On a schedule + Price dipped by (%) also unlocks cross-chain Trigger network.
  await triggerType.selectOption('1');
  await expect(page.getByText('Trigger network')).toHaveCount(0);
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Checks' }).click();
  await page.getByRole('button', { name: /Price dipped by \(%\)/i }).click();
  await page.getByRole('button', { name: /Main path/i }).click();
  await page.locator('.react-flow__node').first().click();
  const scheduleOriginSelect = page
    .getByRole('combobox')
    .filter({ hasText: /Base Sepolia/i })
    .last();
  await expect(scheduleOriginSelect).toBeVisible();
  await scheduleOriginSelect.click();
  await page.getByRole('option', { name: 'Unichain Sepolia' }).click();
});

test('onboards and funds a new wallet directly on Base Sepolia and returns to Base Sepolia without re-onboarding', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const baseChain = createTestClient({ mode: 'anvil', transport: http(ANVIL_BASE_RPC_URL) })
    .extend(publicActions)
    .extend(walletActions);
  const token = getChain(BASE_SEPOLIA_CHAIN_ID).usdc;
  const mint = await baseChain.writeContract({
    address: token,
    abi: parseAbi(['function mint(address to, uint256 amount)']),
    functionName: 'mint',
    args: [BASE_ONBOARD_OWNER, 10_000_000n],
    account: BASE_ONBOARD_OWNER,
    chain: null,
  });
  await baseChain.waitForTransactionReceipt({ hash: mint });

  await installWallet(page, BASE_ONBOARD_OWNER, UNICHAIN_SEPOLIA_CHAIN_ID);
  await page.goto(`${FIXTURE_FRONTEND_URL}/account`);

  await page.getByRole('button', { name: 'Connect wallet to start' }).click();

  const vaultSelect = page
    .getByRole('combobox')
    .filter({ hasText: /Unichain Sepolia/i })
    .first();
  await expect(vaultSelect).toBeVisible();
  await vaultSelect.click();
  await page.getByRole('option', { name: 'Base Sepolia' }).click();

  const review = page.getByRole('region', { name: 'Wallet steps' });
  await expect(review.getByRole('listitem')).toHaveCount(3);
  await expect(review.getByRole('listitem').nth(1)).toContainText('Base Sepolia');

  await page.getByRole('button', { name: 'Create my account' }).click();
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
    BASE_SEPOLIA_CHAIN_ID,
    LASNA_CHAIN_ID,
    LASNA_CHAIN_ID,
    BASE_SEPOLIA_CHAIN_ID,
    BASE_SEPOLIA_CHAIN_ID,
  ]);

  await page.getByRole('button', { name: 'Open Account & Vault' }).click();
  await expect(page.getByRole('heading', { name: 'Account & Vault' })).toBeVisible();
  await expect(
    page
      .getByRole('combobox')
      .filter({ hasText: /Base Sepolia/i })
      .first(),
  ).toBeVisible();
  await expect(page.locator('.rb-balance').filter({ hasText: 'Vault USDC' })).toContainText(
    /10\s*USDC/,
  );
  await expect(page.locator('.rb-balance').filter({ hasText: 'Execution credit' })).toContainText(
    /0\.001\s*ETH/,
  );
  await expect(page.locator('.rb-credit-row').filter({ hasText: 'Watching credit' })).toContainText(
    /0\.1\s*lREACT/,
  );

  // Reloading /account without ?chain= must open Base Sepolia directly without re-onboarding.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Account & Vault' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Step \d of 5/)).toHaveCount(0);
  await expect(
    page
      .getByRole('combobox')
      .filter({ hasText: /Base Sepolia/i })
      .first(),
  ).toBeVisible();
});
