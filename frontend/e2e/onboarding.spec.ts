import { expect, test } from '@playwright/test';

import { approveSetup, approveSignature, installWallet } from './wallet.js';

test('creates an account, funds it, and withdraws principal without an operator', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await installWallet(page);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet' }).click();

  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Create my account' }).click();

  await approveSetup(page);

  // Both contracts exist, on their own networks, before any rule is created.
  await expect(page.getByText('Automation account').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Funds account').first()).toBeVisible();
  const addressLinks = page.locator('a[href*="/address/"]');
  await expect(addressLinks).toHaveCount(2);

  await page.getByRole('button', { name: 'Send starter funds' }).click();
  await expect(page.getByText(/Sent 10 USDC and 0\.01 WETH/)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole('link', { name: 'View your account' }).click();
  await expect(page.getByText('Principal (your funds)')).toBeVisible();

  await page.getByLabel('Withdrawal amount').fill('10');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Withdraw' }).click();

  await approveSignature(page, 'Unichain Sepolia');

  // Success is the destination-chain receipt, not a pending hash or a Lasna receipt.
  await expect(page.getByRole('heading', { name: /Withdrawn on Unichain Sepolia/ })).toBeVisible({
    timeout: 60_000,
  });

  // The full-principal proof: principal reads zero after the confirmed withdrawal.
  await expect(page.getByText('0 USDC')).toBeVisible({ timeout: 30_000 });
});
