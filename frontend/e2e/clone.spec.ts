import { expect, test } from '@playwright/test';

import { FIXTURE_API_URL } from './fixtureConfig.js';
import { approveSignature, installWallet } from './wallet.js';

// A fourth anvil account, so this story owns its own Agent even when every spec shares the
// fixture backend. The rule it clones belongs to the seeded team catalog, never to this wallet.
const CLONER = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as const;
const TEAM_RULE = 'Weekly USDC → WETH DCA';

test('clones a team listing into the cloner’s own account with its own limits', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await installWallet(page, CLONER);

  // A clone needs an Agent and a Vault, so finish onboarding first.
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Create my account' }).click();

  const agentHref = await page
    .getByRole('region', { name: 'Reactive Lasna balances' })
    .locator('a[href*="/address/"]')
    .getAttribute('href');
  const clonerAgent = /0x[0-9a-fA-F]{40}/.exec(agentHref ?? '')?.[0]?.toLowerCase();
  expect(clonerAgent).toBeTruthy();

  await page.goto('/marketplace');
  await expect(page.getByRole('heading', { name: 'Rule marketplace' })).toBeVisible();

  // The seeded catalog makes the first load non-empty and the team badge is never local.
  const card = page.getByRole('article', { name: `${TEAM_RULE} listing` });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Team')).toBeVisible();
  await expect(card.getByText(/\d+ runs/)).toBeVisible();

  await card.getByRole('button', { name: `Clone into my vault: ${TEAM_RULE}` }).click();
  const preview = page.getByRole('region', { name: 'Clone preview' });
  // The panel shows the author's exact sentence, rebuilt from the published parameters.
  await expect(preview).toContainText('buy');
  await expect(preview).toContainText('your own per-run ceiling and budget');

  const confirm = preview.getByRole('button', { name: 'Confirm clone' });
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.click();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });

  const cloned = preview.getByText(/Cloned as rule #\d+/);
  await expect(cloned.or(preview.getByRole('alert'))).toBeVisible({ timeout: 90_000 });
  await expect(cloned).toBeVisible();

  // The receipt confirms on Lasna before the indexer has written the copy; wait for the read
  // model so the rule list assertion is about the clone, not a polling race.
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${FIXTURE_API_URL}/v1/accounts/${clonerAgent ?? ''}/rules?status=all`,
        );
        const body = (await response.json()) as { rules?: readonly unknown[] };
        return body.rules?.length ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBe(1);

  await page.getByRole('link', { name: 'View your rules' }).click();
  await expect(page.getByRole('heading', { name: 'Your rules' })).toBeVisible();

  // The copy lives on the cloner's Agent, not the author's, and it starts active.
  const ruleList = page.getByRole('list', { name: 'Rules in evaluation order' });
  await expect(ruleList).toContainText('buy');
  await expect(ruleList).toContainText('Active');
  const detail = page.getByRole('link', { name: 'Detail' });
  await expect(detail).toHaveCount(1);
  const detailHref = await detail.getAttribute('href');
  expect(detailHref?.toLowerCase()).toContain(clonerAgent);

  await detail.click();
  await expect(page).toHaveURL(new RegExp(clonerAgent ?? '', 'i'));
  await expect(page.getByText('Per-run amount')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Active').first()).toBeVisible();
});
