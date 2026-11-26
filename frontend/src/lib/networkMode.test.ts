import {
  BASE_MAINNET_CHAIN_ID,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from '@rulebook/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildNetworkModeState,
  getStoredNetworkMode,
  NETWORK_MODE_STORAGE_KEY,
} from './networkMode.js';

const factory = '0x1111111111111111111111111111111111111111';

describe('networkMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to testnet and persists valid stored selections', () => {
    expect(getStoredNetworkMode()).toBe('testnet');

    window.localStorage.setItem(NETWORK_MODE_STORAGE_KEY, 'mainnet');
    expect(getStoredNetworkMode()).toBe('mainnet');

    window.localStorage.setItem(NETWORK_MODE_STORAGE_KEY, 'invalid-value');
    expect(getStoredNetworkMode()).toBe('testnet');
  });

  it('builds isolated testnet and mainnet network descriptors', () => {
    const testnet = buildNetworkModeState(
      'testnet',
      JSON.stringify({
        lasna: { factory, startBlock: 10 },
        unichain: { factory, startBlock: 20 },
      }),
    );
    expect(testnet.mode).toBe('testnet');
    expect(testnet.isMainnet).toBe(false);
    expect(testnet.automationChainId).toBe(LASNA_CHAIN_ID);
    expect(testnet.automationName).toBe('Reactive Lasna');
    expect(testnet.nativeSymbol).toBe('lREACT');
    expect(testnet.defaultFundsChainId).toBe(UNICHAIN_SEPOLIA_CHAIN_ID);
    expect(testnet.isDeploymentConfigured).toBe(true);

    const unconfiguredMainnet = buildNetworkModeState('mainnet');
    expect(unconfiguredMainnet.mode).toBe('mainnet');
    expect(unconfiguredMainnet.isMainnet).toBe(true);
    expect(unconfiguredMainnet.automationChainId).toBe(REACTIVE_MAINNET_CHAIN_ID);
    expect(unconfiguredMainnet.automationName).toBe('Reactive Mainnet');
    expect(unconfiguredMainnet.nativeSymbol).toBe('REACT');
    expect(unconfiguredMainnet.defaultFundsChainId).toBe(UNICHAIN_MAINNET_CHAIN_ID);
    expect(unconfiguredMainnet.isDeploymentConfigured).toBe(false);

    const configuredMainnet = buildNetworkModeState(
      'mainnet',
      undefined,
      JSON.stringify({
        reactive: { factory, startBlock: 1 },
        unichain: { factory, startBlock: 2 },
        base: { factory, startBlock: 3 },
      }),
    );
    expect(configuredMainnet.isDeploymentConfigured).toBe(true);
    expect(configuredMainnet.configuredFundsChains).toEqual([
      UNICHAIN_MAINNET_CHAIN_ID,
      BASE_MAINNET_CHAIN_ID,
    ]);
  });
});
