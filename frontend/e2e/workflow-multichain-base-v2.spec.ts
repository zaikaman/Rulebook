import { expect, test } from '@playwright/test';
import { BASE_SEPOLIA_CHAIN_ID, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';

import { FIXTURE_FRONTEND_URL } from './fixtureConfig';
import { approveSignature, installWallet, walletRequests } from './wallet';

const OWNER = '0x976EA74026E726554dB657fA54763abd0C3a0aa9' as const;

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
});
