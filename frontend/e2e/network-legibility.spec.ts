import { expect, test } from '@playwright/test';
import { getChain, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';

import { approveSignature, installWallet, walletRequests } from './wallet.js';

const OWNER = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const lasna = getChain(LASNA_CHAIN_ID);
const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);

test('names the network at every signature from setup to withdrawal', async ({ page }) => {
  test.setTimeout(240_000);
  await installWallet(page, OWNER);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await approveSignature(page, unichain.name);

  const switching = page.getByRole('dialog', { name: `Switch to ${lasna.name}` });
  await expect(switching).toBeVisible({ timeout: 60_000 });
  expect(await walletRequests(page)).toEqual([
    { method: 'eth_signTypedData_v4', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
  ]);
  await expect(switching.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(switching.getByRole('button', { name: `Switch to ${lasna.name}` })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(switching.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await approveSignature(page, lasna.name, { switchNetwork: true });
  expect(await walletRequests(page)).toEqual([
    { method: 'eth_signTypedData_v4', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'wallet_switchEthereumChain', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'eth_sendTransaction', chainId: LASNA_CHAIN_ID },
  ]);

  const funding = page.getByRole('heading', { name: /get test funds/i });
  await expect(funding.locator('[data-chain-id]')).toHaveText(unichain.name, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Send starter funds' }).click();
  await expect(page.getByText(/Sent 10 USDC and 0\.01 WETH/)).toBeVisible({ timeout: 60_000 });
  expect(await walletRequests(page)).toHaveLength(3);

  await page.goto('/create');
  await page.getByLabel('pay with').selectOption({ label: 'USDC' });
  await page.getByLabel('buy').selectOption({ label: 'WETH' });
  await page.getByLabel('amount').selectOption({ label: '10' });
  await page.getByLabel('schedule').selectOption({ label: 'every day' });
  await page.getByRole('button', { name: 'Review and create rule' }).click();
  await approveSignature(page, lasna.name, { switchNetwork: true });
  await expect(page.getByRole('heading', { name: /Rule created/ })).toBeVisible({
    timeout: 90_000,
  });
  expect(await walletRequests(page)).toEqual([
    { method: 'wallet_switchEthereumChain', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'eth_sendTransaction', chainId: LASNA_CHAIN_ID },
  ]);

  await page.getByRole('link', { name: /^Account( & Vault)?$/ }).click({ timeout: 10_000 });
  for (const network of [lasna, unichain]) {
    await expect(page.getByRole('link', { name: `${network.name} explorer` })).toHaveAttribute(
      'href',
      network.explorerUrl,
    );
  }
  const funds = page.getByRole('region', { name: `${unichain.name} balances` });
  await expect(funds.getByText('10 USDC')).toBeVisible();
  await expect(funds.getByText('Execution cost (sponsored)')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: `${lasna.name} balances` })
      .getByText('Watching credit (sponsored)'),
  ).toBeVisible();
  await page.getByLabel('Withdrawal amount').fill('10');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await approveSignature(page, unichain.name, { switchNetwork: true });
  await expect(page.getByRole('heading', { name: /Withdrawn on Unichain Sepolia/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(funds.getByText('0 USDC')).toBeVisible();
  expect((await walletRequests(page)).slice(-2)).toEqual([
    { method: 'wallet_switchEthereumChain', chainId: LASNA_CHAIN_ID },
    { method: 'eth_sendTransaction', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
  ]);
});
