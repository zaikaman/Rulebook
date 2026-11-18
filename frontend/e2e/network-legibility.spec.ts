import { expect, test } from '@playwright/test';
import { getChain, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';

import { approveSignature, installWallet, walletRequests } from './wallet.js';

const OWNER = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const UNSUPPORTED_CHAIN = 50312;
const lasna = getChain(LASNA_CHAIN_ID);
const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);

test('names the network before each wallet request, starting on an unsupported network', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await installWallet(page, OWNER, UNSUPPORTED_CHAIN);
  await page.goto('/rules');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByText(`Unsupported network (${UNSUPPORTED_CHAIN})`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your rules' })).toBeVisible();
  expect(await walletRequests(page)).toEqual([]);
  await page.getByRole('link', { name: 'Account & Vault' }).click();
  await page.getByRole('button', { name: 'Create my account' }).click();

  const switching = page.getByRole('dialog', { name: `Switch to ${lasna.name}` });
  await expect(switching).toBeVisible();
  expect(await walletRequests(page)).toEqual([]);
  await expect(switching.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(switching.getByRole('button', { name: `Switch to ${lasna.name}` })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(switching.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await approveSignature(page, lasna.name, { switchNetwork: true });
  await approveSignature(page, unichain.name, { switchNetwork: true });
  await approveSignature(page, unichain.name);
  await approveSignature(page, lasna.name, { switchNetwork: true });
  await expect(page.getByRole('heading', { name: 'Fund your account' })).toBeVisible({
    timeout: 60_000,
  });
  expect(await walletRequests(page)).toEqual([
    { method: 'wallet_switchEthereumChain', chainId: UNSUPPORTED_CHAIN },
    { method: 'eth_sendTransaction', chainId: LASNA_CHAIN_ID },
    { method: 'wallet_switchEthereumChain', chainId: LASNA_CHAIN_ID },
    { method: 'eth_signTypedData_v4', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'eth_sendTransaction', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'wallet_switchEthereumChain', chainId: UNICHAIN_SEPOLIA_CHAIN_ID },
    { method: 'eth_sendTransaction', chainId: LASNA_CHAIN_ID },
  ]);

  for (const network of [lasna, unichain]) {
    await expect(page.getByRole('link', { name: `${network.name} explorer` })).toHaveAttribute(
      'href',
      network.explorerUrl,
    );
  }
});
