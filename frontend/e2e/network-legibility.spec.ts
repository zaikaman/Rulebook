import { expect, test } from '@playwright/test';
import { getChain, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';

import { installWallet, skipRuleFunding, walletRequests } from './wallet.js';

const OWNER = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const PARTIALLY_APPROVED_OWNER = '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955';
const UNSUPPORTED_CHAIN = 50312;
const lasna = getChain(LASNA_CHAIN_ID);
const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);

test('shows the full setup review before requesting wallet actions on both testnets', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await installWallet(page, OWNER, UNSUPPORTED_CHAIN, { approvedTestnets: [] });
  await page.goto('/rules');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  const wallet = page.getByRole('button', { name: /Wrong network/ });
  await wallet.click();
  const details = page.getByRole('dialog', { name: 'Wallet details' });
  await expect(details.getByText(`Unsupported network (${UNSUPPORTED_CHAIN})`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(wallet).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Your rules' })).toBeVisible();
  expect(await walletRequests(page)).toEqual([]);
  await page.getByRole('link', { name: 'Account & Vault' }).click();
  expect(await walletRequests(page)).toEqual([]);
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Wallet token balances' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create my account' })).toHaveCount(0);
  const addNetworks = page.getByRole('button', { name: 'Add test networks' });
  await addNetworks.click();
  await expect(page.getByRole('region', { name: 'Set up test networks' })).toBeHidden();
  await expect(page.getByText('Step 4 of 5')).toBeVisible();
  const networkRequests = [
    { method: 'wallet_switchEthereumChain', chainId: UNSUPPORTED_CHAIN },
    { method: 'wallet_addEthereumChain', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'wallet_switchEthereumChain', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'wallet_addEthereumChain', chainId: LASNA_CHAIN_ID },
    { method: 'wallet_requestPermissions', chainId: LASNA_CHAIN_ID },
  ];
  expect(await walletRequests(page)).toEqual(networkRequests);

  const review = page.getByRole('region', { name: 'Wallet steps' });
  const steps = review.getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText(lasna.name);
  await expect(steps.nth(1)).toContainText(unichain.name);
  await expect(steps.nth(2)).toContainText(lasna.name);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('heading', { name: 'Fund your account' })).toBeVisible({
    timeout: 60_000,
  });
  expect(await walletRequests(page)).toEqual([
    ...networkRequests,
    { method: 'eth_sendTransaction', chainId: LASNA_CHAIN_ID },
    { method: 'wallet_switchEthereumChain', chainId: LASNA_CHAIN_ID },
    { method: 'eth_signTypedData_v4', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'eth_sendTransaction', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'wallet_switchEthereumChain', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'eth_sendTransaction', chainId: LASNA_CHAIN_ID },
  ]);

  await skipRuleFunding(page);
  await page.goto('/account');
  for (const network of [lasna, unichain]) {
    await expect(page.getByRole('link', { name: `${network.name} explorer` })).toHaveAttribute(
      'href',
      network.explorerUrl,
    );
  }
});

test('uses an installed Lasna network and retries permissions without adding it again', async ({
  page,
}) => {
  await installWallet(page, PARTIALLY_APPROVED_OWNER, UNICHAIN_SEPOLIA_CHAIN_ID, {
    approvedTestnets: [UNICHAIN_SEPOLIA_CHAIN_ID],
    installedTestnets: [LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID],
    omitLasnaFromFirstGrant: true,
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  const networks = page.getByRole('region', { name: 'Set up test networks' });
  await expect(networks.getByText(/Allow Reactive Lasna in your wallet/)).toBeVisible();
  await page.getByRole('button', { name: 'Add test networks' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Allow both Reactive Lasna and Unichain Sepolia' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create my account' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish wallet access' }).click();
  await expect(networks).toBeHidden();
  expect(await walletRequests(page)).toEqual([
    { method: 'wallet_switchEthereumChain', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'wallet_requestPermissions', chainId: LASNA_CHAIN_ID },
    { method: 'wallet_requestPermissions', chainId: LASNA_CHAIN_ID },
  ]);
});

test('manages the wallet from the mobile navigation', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installWallet(page, OWNER, UNSUPPORTED_CHAIN);
  await page.goto('/rules');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  const wallet = page.getByRole('button', { name: /Wrong network/ });
  await expect(wallet).toBeVisible();
  expect((await wallet.boundingBox())?.height).toBeLessThanOrEqual(54);
  await wallet.click();

  const details = page.getByRole('dialog', { name: 'Wallet details' });
  await expect(details).toBeInViewport({ ratio: 1 });
  await details.getByRole('button', { name: unichain.name }).click();
  await expect(details.getByRole('button', { name: unichain.name })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(walletRequests(page)).resolves.toEqual([
    { method: 'wallet_switchEthereumChain', chainId: UNSUPPORTED_CHAIN },
  ]);
  await details.getByRole('button', { name: 'Copy address' }).click();
  await expect(details.getByRole('button', { name: 'Address copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(OWNER);

  await details.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(details).toBeHidden();
});
