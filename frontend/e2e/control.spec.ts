import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_API_URL } from './fixtureConfig.js';
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
  const agentHref = await page.locator('a[href*="/address/"]').first().getAttribute('href');
  const agent = /0x[0-9a-fA-F]{40}/.exec(agentHref ?? '')?.[0]?.toLowerCase();

  await createRule(page, '10');
  // 10 USDC keeps both rules inside the fixture's starter USDC balance as well as the vault's
  // 100 USDC per-run ceiling.
  await createRule(page, '10');

  // The indexer in the fixture writes the rule rows the control screens read; wait for both so
  // the first `/rules` load does not cache an empty list.
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${FIXTURE_API_URL}/v1/accounts/${agent ?? ''}/rules?status=all`,
        );
        const body = (await response.json()) as { rules?: readonly unknown[] };
        return body.rules?.length ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBe(2);
  await page.goto('/rules');
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30_000 });

  // Pause the first rule and confirm the pill, not a pending toast, changed.
  await rows.first().getByRole('link', { name: 'Detail' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused').first()).toBeVisible();

  // The reload reads the indexed status, so wait for the indexer to record the pause first.
  const pausedRuleId = /\/rules\/0x[0-9a-fA-F]{40}\/(\d+)/.exec(page.url())?.[1];
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${FIXTURE_API_URL}/v1/accounts/${agent ?? ''}/rules?status=all`,
        );
        const body = (await response.json()) as {
          rules?: ReadonlyArray<{ rule_id: string; status: string }>;
        };
        return body.rules?.find((rule) => rule.rule_id === pausedRuleId)?.status;
      },
      { timeout: 30_000 },
    )
    .toBe('paused');

  // Reload proves the change reached the Agent and the read model, not just local state.
  await page.reload();
  await expect(page.getByText('Paused').first()).toBeVisible({ timeout: 30_000 });
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
