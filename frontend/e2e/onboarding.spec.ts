import { expect, test } from '@playwright/test';

import { ANVIL_RPC_URL, USER_ADDRESS } from './fixtureConfig';

/** Injects a minimal EIP-1193 provider backed by anvil's unlocked second account. */
async function installWallet(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ({ user, rpc }) => {
      let chainId = '0x515'; // Unichain Sepolia (1301)
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
    { user: USER_ADDRESS, rpc: ANVIL_RPC_URL },
  );
}

test('creates an account, funds it, and withdraws principal without an operator', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await installWallet(page);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet' }).click();

  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Create my account' }).click();

  // Both contracts exist, on their own networks, before any rule is created.
  await expect(page.getByText('Automation account').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Funds account').first()).toBeVisible();
  const addressLinks = page.locator('a[href*="/address/"]');
  await expect(addressLinks).toHaveCount(2);

  await page.getByRole('button', { name: 'Send starter funds' }).click();
  await expect(page.getByText(/Sent 10 USDC and 0\.01 WETH/)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole('link', { name: 'View your account' }).click();
  await expect(page.getByText('Principal (your funds)')).toBeVisible();

  await page.getByLabel('Withdrawal amount').fill('10');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Withdraw' }).click();

  // Success is the destination-chain receipt, not a pending hash or a Lasna receipt.
  await expect(page.getByRole('heading', { name: /Withdrawn on Unichain Sepolia/ })).toBeVisible({
    timeout: 60_000,
  });

  // The full-principal proof: principal reads zero after the confirmed withdrawal.
  await expect(page.getByText('0 USDC')).toBeVisible({ timeout: 30_000 });
});
