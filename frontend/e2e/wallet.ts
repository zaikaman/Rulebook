import { expect, type Page } from '@playwright/test';
import type { Address } from 'viem';

import { ANVIL_RPC_URL, USER_ADDRESS } from './fixtureConfig.js';

type WalletRequest = { readonly method: string; readonly chainId: number };
type WalletWindow = Window & { rulebookWalletRequests: WalletRequest[] };

export function walletRequests(page: Page): Promise<WalletRequest[]> {
  return page.evaluate(() => (window as WalletWindow).rulebookWalletRequests);
}

/**
 * Injects a minimal EIP-1193 provider backed by anvil's unlocked second account. No real
 * wallet, seed phrase, or public network is involved.
 */
export async function installWallet(page: Page, user: Address = USER_ADDRESS): Promise<void> {
  await page.addInitScript(
    ({ user, rpc }) => {
      let chainId = '0x515'; // Unichain Sepolia (1301)
      const walletRequests: WalletRequest[] = [];
      (window as WalletWindow).rulebookWalletRequests = walletRequests;
      const listeners = new Map<string, Array<(value: unknown) => void>>();
      const emit = (event: string, value: unknown): void => {
        for (const listener of listeners.get(event) ?? []) listener(value);
      };

      const ethereum = {
        isMetaMask: true,
        selectedAddress: user,
        chainId,
        async request({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }): Promise<unknown> {
          if (
            ['wallet_switchEthereumChain', 'eth_signTypedData_v4', 'eth_sendTransaction'].includes(
              method,
            )
          ) {
            walletRequests.push({ method, chainId: Number.parseInt(chainId, 16) });
          }
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [user];
          if (method === 'eth_chainId') return chainId;
          if (method === 'net_version') return String(Number.parseInt(chainId, 16));
          if (method === 'wallet_switchEthereumChain') {
            const target = (params?.[0] as { chainId?: string } | undefined)?.chainId;
            if (target) {
              chainId = target;
              emit('chainChanged', chainId);
            }
            return null;
          }
          if (method === 'wallet_addEthereumChain') return null;
          if (method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];

          const args = [...(params ?? [])];
          if (method === 'eth_sendTransaction' && args[0]) {
            args[0] = { ...(args[0] as Record<string, unknown>), from: user };
          }
          if (method === 'eth_signTypedData_v4' && typeof args[1] === 'string') {
            args[1] = JSON.parse(args[1]);
          }
          const response = await fetch(rpc, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: args }),
          });
          const body = (await response.json()) as {
            result?: unknown;
            error?: { code: number; message: string };
          };
          if (body.error) {
            const error = new Error(body.error.message) as Error & { code?: number };
            error.code = body.error.code;
            throw error;
          }
          return body.result;
        },
        on(event: string, listener: (value: unknown) => void): void {
          const existing = listeners.get(event) ?? [];
          existing.push(listener);
          listeners.set(event, existing);
        },
        removeListener(event: string, listener: (value: unknown) => void): void {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
          );
        },
      };

      Object.defineProperty(window, 'ethereum', { value: ethereum, configurable: true });
    },
    { user, rpc: ANVIL_RPC_URL },
  );
}

export async function approveSignature(
  page: Page,
  network: string,
  { switchNetwork = false } = {},
) {
  if (switchNetwork) {
    const switching = page.getByRole('dialog', { name: `Switch to ${network}` });
    await expect(switching.locator('[data-chain-id]')).toBeVisible({ timeout: 60_000 });
    await expect(switching.locator('[data-chain-id]')).toHaveText(network);
    await switching.getByRole('button', { name: `Switch to ${network}` }).click();
  }
  const review = page.getByRole('dialog', { name: `Review signature on ${network}` });
  await expect(review.locator('[data-chain-id]')).toBeVisible({ timeout: 60_000 });
  await expect(review.locator('[data-chain-id]')).toHaveText(network);
  await review.getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(review).toBeHidden({ timeout: 60_000 });
}

export async function approveSetup(page: Page) {
  await approveSignature(page, 'Unichain Sepolia');
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await expect(page.getByRole('link', { name: 'View your account' })).toBeVisible({
    timeout: 60_000,
  });
}
