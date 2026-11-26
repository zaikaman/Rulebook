import { expect, test } from '@playwright/test';

import { FIXTURE_FRONTEND_URL } from './fixtureConfig';

const appUrl = process.env.RULEBOOK_E2E_LIVE_APP ?? FIXTURE_FRONTEND_URL;

test.use({ viewport: { width: 1440, height: 940 } });

test('defaults to Testnet and cleanly switches between Testnet and Mainnet without errors', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${appUrl}/workflows`);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  const testnetToggle = page.getByTestId('network-mode-testnet');
  const mainnetToggle = page.getByTestId('network-mode-mainnet');
  const activeNetwork = page.getByTestId('active-automation-network');
  const sidebarMode = page.getByTestId('sidebar-network-mode');
  const sidebarAutomation = page.getByTestId('sidebar-automation-network');
  const sidebarFundsSummary = page.getByTestId('sidebar-funds-summary');
  const sidebarNote = page.getByTestId('sidebar-network-note');

  await expect(testnetToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(mainnetToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(activeNetwork).toContainText('Reactive Lasna');
  await expect(sidebarMode).toHaveText('Testnet');
  await expect(sidebarAutomation).toContainText('Reactive Lasna');
  await expect(sidebarFundsSummary).toContainText('Unichain Sepolia');

  await mainnetToggle.click();
  await expect(mainnetToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(testnetToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(activeNetwork).toContainText('Reactive Mainnet');
  await expect(sidebarMode).toHaveText('Mainnet');
  await expect(sidebarMode).toHaveAttribute('data-tone', 'paused');
  await expect(sidebarAutomation).toContainText('Reactive Mainnet');
  await expect(sidebarFundsSummary).toContainText('Unichain');
  await expect(sidebarFundsSummary).not.toContainText('Sepolia');
  await expect(sidebarNote).not.toContainText('Reactive Lasna');
  await expect(page.getByText('Mainnet contracts are not deployed yet')).toBeVisible();

  await page.reload();
  await expect(mainnetToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(activeNetwork).toContainText('Reactive Mainnet');
  await expect(sidebarMode).toHaveText('Mainnet');
  await expect(sidebarMode).toHaveAttribute('data-tone', 'paused');
  await expect(sidebarAutomation).toContainText('Reactive Mainnet');
  await expect(sidebarFundsSummary).toContainText('Unichain');
  await expect(sidebarFundsSummary).not.toContainText('Sepolia');
  await expect(sidebarNote).not.toContainText('Reactive Lasna');

  await page.getByRole('button', { name: 'Switch to Testnet' }).click();
  await expect(testnetToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(activeNetwork).toContainText('Reactive Lasna');
  await expect(sidebarMode).toHaveText('Testnet');
  await expect(sidebarAutomation).toContainText('Reactive Lasna');
  await expect(page.getByText('Mainnet contracts are not deployed yet')).toBeHidden();

  expect(pageErrors).toEqual([]);
});

test('?network= query parameter initializes and preserves network mode across reloads', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(`${appUrl}/runs/nonexistent-run?network=mainnet`);
  await page.goto(`${appUrl}/workflows`);
  await expect(page.getByTestId('network-mode-mainnet')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('active-automation-network')).toContainText('Reactive Mainnet');
  await expect(page.getByTestId('sidebar-network-mode')).toHaveText('Mainnet');
  await expect(page.getByTestId('sidebar-automation-network')).toContainText('Reactive Mainnet');

  await page.goto(`${appUrl}/marketplace?network=testnet`);
  await expect(page.getByTestId('network-mode-testnet')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('active-automation-network')).toContainText('Reactive Lasna');
  await expect(page.getByTestId('sidebar-network-mode')).toHaveText('Testnet');
  await expect(page.getByTestId('sidebar-automation-network')).toContainText('Reactive Lasna');

  expect(pageErrors).toEqual([]);
});

test('/workflows/:id/edit shows MainnetUnavailableCallout when mainnet is unconfigured', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(
    `${appUrl}/workflows/0x1111111111111111111111111111111111111111111111111111111111111111/edit?network=mainnet`,
  );

  await expect(page.getByText('Mainnet contracts are not deployed yet')).toBeVisible();
  await expect(
    page.getByText('Editing workflows requires deployed Mainnet Agent and Vault factories.'),
  ).toBeVisible();
  await expect(page.getByText('This wallet has no workflow account.')).toBeHidden();

  await page.getByRole('button', { name: 'Switch to Testnet' }).click();
  await expect(page.getByTestId('network-mode-testnet')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('active-automation-network')).toContainText('Reactive Lasna');
  await expect(page.getByText('Mainnet contracts are not deployed yet')).toBeHidden();

  expect(pageErrors).toEqual([]);
});
