import { expect, test, type Page } from '@playwright/test';

import { installWallet } from './wallet.js';

// A third anvil account, so the control story never shares state with onboarding or compose.
const CONTROLLER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as const;

async function createRule(page: Page, amountLabel: string): Promise<void> {
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Compose a rule' })).toBeVisible();
  await page.getByLabel('pay with').selectOption({ label: 'USDC' });
  await page.getByLabel('buy').selectOption({ label: 'WETH' });
  await page.getByLabel('amount').selectOption({ label: amountLabel });
  await page.getByLabel('schedule').selectOption({ label: 'every day' });
  await page.getByRole('button', { name: /sign once and create rule/i }).click();
  await expect(page.getByRole('heading', { name: /Rule created/ })).toBeVisible({
    timeout: 90_000,
  });
}

test('pausing a rule persists and a reorder survives a reload', async ({ page }) => {
  test.setTimeout(300_000);
  await installWallet(page, CONTROLLER);

  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByText('Automation account').first()).toBeVisible({ timeout: 60_000 });

  await createRule(page, '10');
  await createRule(page, '5');

  // The indexer in the fixture writes the rule rows the control screens read.
  await page.goto('/rules');
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30_000 });

  // Pause the first rule and confirm the pill, not a pending toast, changed.
  await rows.first().getByRole('link', { name: 'Detail' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused')).toBeVisible();

  // Reload proves the change reached the Agent and the read model, not just local state.
  await page.reload();
  await expect(page.getByText('Paused')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  // Move the second rule to the top, then prove the permutation survives a reload.
  const order = page.locator('[data-testid^="rule-order-"]');
  await expect(order).toHaveCount(2, { timeout: 30_000 });
  const firstId = await order.nth(0).getAttribute('data-testid');
  const secondId = await order.nth(1).getAttribute('data-testid');
  await order
    .nth(1)
    .getByRole('button', { name: /Move rule .* up/ })
    .click();

  await expect(order.nth(0)).toHaveAttribute('data-testid', secondId ?? '');

  await page.reload();
  const reloaded = page.locator('[data-testid^="rule-order-"]');
  await expect(reloaded.nth(0)).toHaveAttribute('data-testid', secondId ?? '', {
    timeout: 30_000,
  });
  await expect(reloaded.nth(0)).toContainText('Runs first');
  await expect(reloaded.nth(1)).toHaveAttribute('data-testid', firstId ?? '');
});
