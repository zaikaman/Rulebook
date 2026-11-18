import { expect, test } from '@playwright/test';

import { approveSetup, approveSignature, installWallet } from './wallet.js';

test('guides a new wallet through setup and self-funding from the composer', async ({ page }) => {
  test.setTimeout(240_000);
  await installWallet(page);
  await page.goto('/create');
  await page.getByRole('button', { name: 'Connect wallet' }).click();

  await expect(page.getByRole('heading', { name: 'Set up your account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get Lasna REACT' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get Unichain Sepolia ETH' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get Unichain Sepolia USDC' })).toBeVisible();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await approveSetup(page);

  await expect(page.getByRole('heading', { name: 'Before your first rule runs' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Add funds', exact: true }).click();
  const funding = page.getByRole('region', { name: 'Fund your account' });
  await expect(funding.getByLabel('Fund with')).toHaveValue('watching');
  await funding.getByLabel('Amount (REACT)').fill('0.1');
  await expect(funding.getByText(/Less than one day of monitoring/)).toBeVisible();
  await funding.getByRole('button', { name: 'Add network fees' }).click();
  await approveSignature(page, 'Reactive Lasna');
  await expect(funding.getByText('Deposit confirmed.')).toBeVisible();

  await expect(funding.getByLabel('Fund with')).toHaveValue('execution');
  await funding.getByLabel('Amount (ETH)').fill('0.01');
  await funding.getByRole('button', { name: 'Add network fees' }).click();
  await approveSignature(page, 'Unichain Sepolia', { switchNetwork: true });
  await expect(funding.getByText('Deposit confirmed.')).toBeVisible();

  await expect(funding.getByLabel('Fund with')).toHaveValue('vault');
  await funding.getByLabel('Amount (USDC)').fill('10');
  await funding.getByRole('button', { name: 'Deposit USDC' }).click();
  await approveSignature(page, 'Unichain Sepolia');
  await approveSignature(page, 'Unichain Sepolia');
  await expect(funding.getByText('Deposit confirmed.')).toBeVisible();

  await page.getByRole('link', { name: 'Account & Vault' }).click();
  await expect(page.getByText('0.1 REACT', { exact: true })).toBeVisible();
  await expect(page.getByText('0.01 ETH', { exact: true })).toBeVisible();
  await expect(page.getByText('10 USDC', { exact: true })).toBeVisible();

  await page.getByLabel('Withdrawal amount').fill('10');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await approveSignature(page, 'Unichain Sepolia');

  await expect(page.getByRole('heading', { name: /Withdrawn on Unichain Sepolia/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('0 USDC', { exact: true })).toBeVisible();
});
