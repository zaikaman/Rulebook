import { expect, test } from '@playwright/test';
import { encodeAddRule } from '@rulebook/shared';
import { toFunctionSelector } from 'viem';

import { TEMPLATE_FIXTURES } from '../../contracts/test/templates/fixtures.generated.js';
import { ANVIL_RPC_URL } from './fixtureConfig.js';
import {
  approveSignature,
  fundFixtureVault,
  installWallet,
  skipRuleFunding,
  walletRequests,
} from './wallet.js';

const AGENT_PLACEHOLDER = '0x1111111111111111111111111111111111111111' as const;
// A different anvil account than the onboarding spec uses, so each story owns its own account
// even when both specs share one fixture backend.
const COMPOSER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const;

const dca = TEMPLATE_FIXTURES.find((fixture) => fixture.template === 1);
if (!dca) throw new Error('DCA fixture missing');

// Spend 0.1 USDC, expressed in the fixture's on-chain units.
const expectedCalldata = encodeAddRule(AGENT_PLACEHOLDER, {
  template: dca.template,
  chainId: 1301,
  slots: { ...dca.slots, amount_in: '100000' },
});

test('composes a USDC→WETH DCA sentence, matches the fixture, and signs once', async ({ page }) => {
  test.setTimeout(240_000);
  await installWallet(page, COMPOSER);

  // A rule needs an Agent, so finish onboarding first.
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Create my account' }).click();
  await skipRuleFunding(page);

  await page.goto('/rules');
  await expect(page.getByRole('heading', { name: 'No rules yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Add test ETH to run trades and transfers' }).click();
  await expect(page.getByRole('heading', { name: 'Add execution fees' })).toBeFocused();
  await expect(page.getByLabel('Amount (ETH)')).toBeVisible();
  await expect(page.getByLabel('Amount (REACT)')).toHaveCount(0);
  await expect(page.getByLabel('Fund with')).toHaveCount(0);
  const depositTo = toFunctionSelector('depositTo(address)');
  let fundingHash: string | undefined;
  await page.route(ANVIL_RPC_URL, async (route) => {
    const rpc = route.request().postDataJSON();
    if (rpc?.method === 'eth_sendTransaction' && rpc.params[0]?.data?.startsWith(depositTo)) {
      const response = await route.fetch();
      fundingHash = (await response.json()).result;
      await route.fulfill({ response });
      return;
    }
    if (
      fundingHash &&
      rpc?.method === 'eth_getTransactionReceipt' &&
      rpc.params[0] === fundingHash
    ) {
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          jsonrpc: '2.0',
          id: rpc.id,
          error: { code: -32602, message: 'Receipt lookup unavailable in this test' },
        },
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Add ETH' }).click();
  await approveSignature(page, 'Unichain Sepolia');
  const checkTransaction = page.getByRole('button', { name: 'Check transaction' });
  await expect(checkTransaction).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Add ETH' })).toBeDisabled();
  expect(
    (await walletRequests(page)).filter(({ method }) => method === 'eth_sendTransaction'),
  ).toHaveLength(1);
  await page.reload();
  await expect(checkTransaction).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add ETH' })).toBeDisabled();
  await page.unroute(ANVIL_RPC_URL);
  await checkTransaction.click();
  await expect(page.getByText('Deposit confirmed.')).toBeVisible();
  expect(
    (await walletRequests(page)).filter(({ method }) => method === 'eth_sendTransaction'),
  ).toHaveLength(0);
  await page.getByRole('link', { name: 'Back to rules' }).click();
  await expect(page.getByRole('link', { name: 'Add test REACT to monitor rules' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add test ETH to run trades and transfers' }),
  ).toHaveCount(0);

  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Compose a rule' })).toBeVisible();

  await page.getByLabel('Pay with').selectOption({ label: 'USDC' });
  await page.getByLabel('Receive', { exact: true }).selectOption({ label: 'WETH' });
  await page.getByLabel('Amount to spend').fill('0.1');
  await page.getByLabel('Schedule').selectOption({ label: 'Every day' });

  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
  await expect(page.getByTestId('composer-sentence')).toHaveText(
    'Every day, spend 0.1 USDC to buy WETH.',
  );
  await expect(page.getByTestId('live-calldata')).toHaveText(expectedCalldata);

  await page.getByRole('button', { name: 'Review and create rule' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Your vault has 0 USDC available.' }),
  ).toContainText('Deposit at least 0.1 USDC');
  await expect(page.getByRole('link', { name: /Fund your vault/ })).toHaveAttribute(
    'href',
    '/account',
  );
  expect(
    (await walletRequests(page)).filter(({ method }) => method === 'eth_sendTransaction'),
  ).toHaveLength(0);

  await fundFixtureVault(COMPOSER, 100_000n);
  await page.getByRole('button', { name: 'Review and create rule' }).click();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });

  // Success is the Lasna receipt with the rule id, not a pending hash.
  await expect(page.getByRole('heading', { name: /Rule created/ })).toBeVisible({
    timeout: 90_000,
  });
});
