import { expect, test } from '@playwright/test';
import { encodeAddRule } from '@rulebook/shared';

import { TEMPLATE_FIXTURES } from '../../contracts/test/templates/fixtures.generated.js';
import { approveSetup, approveSignature, installWallet } from './wallet.js';

const AGENT_PLACEHOLDER = '0x1111111111111111111111111111111111111111' as const;
// A different anvil account than the onboarding spec uses, so each story owns its own account
// even when both specs share one fixture backend.
const COMPOSER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const;

const dca = TEMPLATE_FIXTURES.find((fixture) => fixture.template === 1);
if (!dca) throw new Error('DCA fixture missing');

// The encoded calldata does not depend on the Agent address, so the fixture is the oracle.
const expectedCalldata = encodeAddRule(AGENT_PLACEHOLDER, {
  template: dca.template,
  chainId: 1301,
  slots: { ...dca.slots },
});

test('composes a USDC→WETH DCA sentence, matches the fixture, and signs once', async ({ page }) => {
  test.setTimeout(240_000);
  await installWallet(page, COMPOSER);

  // A rule needs an Agent, so finish onboarding first.
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your account' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Create my account' }).click();
  await approveSetup(page);

  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Compose a rule' })).toBeVisible();

  const amount = page.getByLabel('amount', { exact: true });
  await page.getByRole('button', { name: '10', exact: true }).dragTo(amount, { steps: 12 });
  await expect(amount).toHaveValue('10000000');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');

  await page.getByLabel('pay with').selectOption({ label: 'USDC' });
  await page.getByLabel('buy').selectOption({ label: 'WETH' });
  await page.getByLabel('schedule').selectOption({ label: 'every day' });

  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
  await expect(page.getByTestId('live-calldata')).toHaveText(expectedCalldata);

  await page.getByRole('button', { name: 'Review and create rule' }).click();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });

  // Success is the Lasna receipt with the rule id, not a pending hash.
  await expect(page.getByRole('heading', { name: /Rule created/ })).toBeVisible({
    timeout: 90_000,
  });
});
