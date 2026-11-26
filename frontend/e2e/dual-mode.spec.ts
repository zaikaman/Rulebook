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

  await expect(testnetToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(mainnetToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(activeNetwork).toContainText('Reactive Lasna');

  await mainnetToggle.click();
  await expect(mainnetToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(testnetToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(activeNetwork).toContainText('Reactive Mainnet');
  await expect(page.getByText('Mainnet contracts are not deployed yet')).toBeVisible();

  await page.reload();
  await expect(mainnetToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(activeNetwork).toContainText('Reactive Mainnet');

  await page.getByRole('button', { name: 'Switch to Testnet' }).click();
  await expect(testnetToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(activeNetwork).toContainText('Reactive Lasna');
  await expect(page.getByText('Mainnet contracts are not deployed yet')).toBeHidden();

  expect(pageErrors).toEqual([]);
});
