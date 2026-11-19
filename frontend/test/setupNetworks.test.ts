import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { expect, it, vi } from 'vitest';

import { checkSetupNetworks } from '../src/lib/setupNetworks.js';

const owner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const other = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

it('counts only the connected account’s approved WalletConnect networks', async () => {
  const connector = {
    type: 'walletConnect',
    getChainId: vi.fn(),
    getProvider: async () => ({
      session: {
        namespaces: {
          [`eip155:${LASNA_CHAIN_ID}`]: { accounts: [`eip155:${LASNA_CHAIN_ID}:${owner}`] },
          [`eip155:${UNICHAIN_SEPOLIA_CHAIN_ID}`]: {
            accounts: [`eip155:${UNICHAIN_SEPOLIA_CHAIN_ID}:${other}`],
          },
        },
      },
    }),
  };

  await expect(checkSetupNetworks(connector, owner)).resolves.toEqual([LASNA_CHAIN_ID]);
  expect(connector.getChainId).not.toHaveBeenCalled();
});

it('uses the active network if the browser wallet cannot report approved networks', async () => {
  const request = vi.fn().mockRejectedValue({ code: 4200 });
  const connector = {
    type: 'injected',
    getChainId: async () => UNICHAIN_SEPOLIA_CHAIN_ID,
    getProvider: async () => ({ request }),
  };

  await expect(checkSetupNetworks(connector, owner)).resolves.toEqual([UNICHAIN_SEPOLIA_CHAIN_ID]);
  expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'wallet_getPermissions' });
});
