import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_API_URL } from './fixtureConfig.js';
import { approveSignature, fundFixtureVault, installWallet, skipRuleFunding } from './wallet.js';

// A third anvil account, so the control story never shares state with onboarding or compose.
const CONTROLLER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as const;

async function createRule(page: Page, amountLabel: string): Promise<void> {
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Compose a rule' })).toBeVisible();
  await page.getByLabel('Pay with').selectOption({ label: 'USDC' });
  await page.getByLabel('Receive', { exact: true }).selectOption({ label: 'WETH' });
  await page.getByLabel('Amount to spend').fill(amountLabel);
  await page.getByLabel('Schedule', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Review and create rule' }).click();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await expect(page.getByRole('heading', { name: /Rule created/ })).toBeVisible({
    timeout: 90_000,
  });
}

test('rules keep live priority, replacement history, and current funding status', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await installWallet(page, CONTROLLER);

  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Create my account' }).click();
  await skipRuleFunding(page);
  await fundFixtureVault(CONTROLLER, 20_000_000n);
  await page.goto('/account');
  const agentHref = await page
    .getByRole('region', { name: 'Reactive Lasna balances' })
    .locator('a[href*="/address/"]')
    .getAttribute('href');
  const agent = /0x[0-9a-fA-F]{40}/.exec(agentHref ?? '')?.[0]?.toLowerCase();

  await createRule(page, '10');
  // 10 USDC keeps both rules inside the vault's
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
  const rows = page.getByRole('list', { name: 'Current rules' }).getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30_000 });

  // Pause the first rule and confirm the pill, not a pending toast, changed.
  await rows.first().getByRole('link', { name: 'Detail' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
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

  await page.getByRole('link', { name: 'Your rules' }).click();
  const order = page.locator('[data-testid^="rule-order-"]');
  await expect(order).toHaveCount(1, { timeout: 30_000 });
  await expect(order.first()).not.toHaveAttribute('data-testid', `rule-order-${pausedRuleId}`);

  await page.goto(`/rules/${agent}/${pausedRuleId}`);
  await page.getByRole('button', { name: 'Resume' }).click();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('link', { name: 'Your rules' }).click();

  // Move the second enabled rule to the top and verify the chain order after reload.
  await expect(order).toHaveCount(2, { timeout: 30_000 });
  const firstId = await order.nth(0).getAttribute('data-testid');
  const secondId = await order.nth(1).getAttribute('data-testid');
  await order
    .nth(1)
    .getByRole('button', { name: /Move rule .* up/ })
    .click();
  await approveSignature(page, 'Reactive Lasna');

  await expect(order.nth(0)).toHaveAttribute('data-testid', secondId ?? '');

  await page.reload();
  const reloaded = page.locator('[data-testid^="rule-order-"]');
  await expect(reloaded.nth(0)).toHaveAttribute('data-testid', secondId ?? '', {
    timeout: 30_000,
  });
  await expect(reloaded.nth(0)).toContainText('Evaluated first');
  await expect(reloaded.nth(1)).toHaveAttribute('data-testid', firstId ?? '');

  await rows.first().getByRole('link', { name: 'Detail' }).click();
  const previousUrl = page.url();
  await page.getByRole('link', { name: 'Edit rule' }).click();
  await expect(page.getByLabel('Amount to spend')).toHaveValue('10');
  await page.getByLabel('Amount to spend').fill('25');
  await page.getByRole('button', { name: 'Review and save changes' }).click();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await expect(page.getByRole('heading', { name: 'Rule #2' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Waiting for funds').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('link', { name: /rule #/i }).first()).toHaveAttribute(
    'href',
    new URL(previousUrl).pathname,
  );

  await page.getByRole('link', { name: 'Your rules' }).click();
  await expect(order.first()).toHaveAttribute('data-testid', 'rule-order-2');
  await expect(rows).toHaveCount(2);
  await page.getByText('History (1)').click();
  await expect(page.getByRole('list', { name: 'Retired rules' })).toContainText('Replaced');

  await page.setViewportSize({ width: 390, height: 844 });
  await rows.first().getByRole('link', { name: 'Detail' }).click();
  await expect(page.getByText('Waiting for funds').first()).toBeVisible();
  await expect(page.getByText('20 USDC available in the Vault.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('waiting-for-funds-mobile.png') });

  await fundFixtureVault(CONTROLLER, 5_000_000n);
  await expect(page.getByRole('heading', { name: 'Rule #2' })).toBeVisible();
  await expect(page.getByText('Waiting for funds')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
});
