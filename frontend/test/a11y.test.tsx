import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

import { FIXTURE_API_URL } from '../e2e/fixtureConfig.js';
import { installWallet, skipRuleFunding } from '../e2e/wallet.js';

const require = createRequire(import.meta.url);
const axeScript = require.resolve('axe-core/axe.min.js');
const hash = `0x${'a'.repeat(64)}`;
// Use an Anvil account reserved for this suite so the earlier story tests cannot onboard it.
const owner = '0x976EA74026E726554dB657fA54763abd0C3a0aa9';

test.use({ reducedMotion: 'reduce' });

async function audit(page: Page, context: string | undefined = undefined) {
  await page.addScriptTag({ path: axeScript });
  const result = await page.evaluate(async (selector) => {
    const { axe } = window as Window & {
      axe?: { run(root: Document | string): Promise<AxeResults> };
    };
    if (!axe) throw new Error('axe did not load');
    return axe.run(selector ?? document);
  }, context);
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
  ).toEqual([]);
}

test('audits the public and workspace routes', async ({ page }) => {
  test.setTimeout(90_000);
  for (const [path, heading] of [
    ['/', 'Automate trades, transfers, and alerts'],
    ['/rules', 'Your rules'],
    ['/create', 'Connect your wallet'],
    ['/proof', 'Execution proof'],
    ['/marketplace', 'Marketplace'],
    ['/leaderboard', 'Automation leaderboard'],
    ['/account', 'Connect your wallet'],
    ['/cost', 'Cost & custody model'],
  ] as const) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await audit(page);
    });
  }
  await page.route('**/v1/proofs/**', (route) =>
    route.fulfill({
      json: {
        reactive_tx: hash,
        source: 'chain',
        cache_age_seconds: null,
        latency_ms: 3000,
        rows: ['origin', 'automation', 'destination'].map((role, index) => ({
          role,
          chain_id: role === 'automation' ? 5318007 : 1301,
          tx_hash: hash,
          block_number: index + 1,
          timestamp: '2026-11-18T10:00:00Z',
          explorer_url: `https://example.com/tx/${hash}`,
          error: null,
        })),
      },
    }),
  );
  await page.goto(`/proof/${hash}`);
  await expect(page.getByTestId('proof-row')).toHaveCount(3);
  await audit(page);
});

test('audits the connected composer, rule detail and both wallet prompts', async ({ page }) => {
  test.setTimeout(150_000);
  await installWallet(page, owner);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  const startSetup = page.getByRole('button', { name: 'Create my account' });
  await expect(startSetup).toBeEnabled();
  await audit(page);
  await startSetup.click();
  await expect(page.getByRole('button', { name: 'Add REACT' })).toBeEnabled();
  await audit(page);
  await skipRuleFunding(page);
  await page.goto('/account');
  const agentHref = await page
    .getByRole('region', { name: 'Reactive Lasna balances' })
    .locator('a[href*="/address/"]')
    .getAttribute('href');
  const agent = agentHref?.match(/0x[a-f0-9]{40}/i)?.[0];
  expect(agent).toBeTruthy();

  await page.goto('/create');
  await page.getByRole('button', { name: 'Rule composer guide' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a rule type' })).toBeVisible();
  await audit(page, '.driver-popover');
  await page.keyboard.press('Escape');
  await page.getByLabel('pay with').selectOption({ label: 'USDC' });
  await page.getByLabel('buy').selectOption({ label: 'WETH' });
  await page.getByLabel('amount').selectOption({ label: '10' });
  await page.getByLabel('schedule').selectOption({ label: 'every day' });
  await audit(page);

  await page.getByRole('button', { name: 'Review and create rule' }).click();
  const switchPrompt = page.getByRole('dialog', { name: 'Switch to Reactive Lasna' });
  await expect(switchPrompt).toBeVisible();
  await audit(page, 'dialog[open]');
  await switchPrompt.getByRole('button', { name: 'Switch to Reactive Lasna' }).click();

  const signature = page.getByRole('dialog', { name: 'Review signature on Reactive Lasna' });
  await expect(signature).toBeVisible();
  await audit(page, 'dialog[open]');
  await signature.getByRole('button', { name: 'Continue to wallet' }).click();
  const outcome = page.getByRole('heading', { name: /Rule created/ });
  await expect(outcome).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${FIXTURE_API_URL}/v1/accounts/${agent}/rules?status=all`,
        );
        const result = (await response.json()) as { rules?: unknown[] };
        return result.rules?.length;
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  await page.goto('/rules');
  await page.getByRole('link', { name: 'Detail' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const funding = page.getByRole('link', { name: 'Add test REACT to monitor rules' });
  await expect(funding).toBeVisible();
  await audit(page);
  await page.getByRole('button', { name: /^Wallet / }).click();
  await page
    .getByRole('dialog', { name: 'Wallet details' })
    .getByRole('button', { name: 'Disconnect' })
    .click();
  await expect(page.getByRole('complementary', { name: 'Rule fee status' })).toBeVisible();
  await expect(funding).toHaveCount(0);
});
