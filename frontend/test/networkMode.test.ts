import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NETWORK_MODE_STORAGE_KEY,
  getInitialNetworkMode,
  getStoredNetworkMode,
  getUrlNetworkMode,
  setStoredNetworkMode,
  withNetworkQuery,
} from '../src/lib/networkMode.js';

describe('networkMode storage & URL helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to testnet when localStorage is unavailable or empty', () => {
    expect(getStoredNetworkMode()).toBe('testnet');
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    });
    expect(getStoredNetworkMode()).toBe('testnet');
  });

  it('reads mainnet when stored', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => 'mainnet',
        setItem: () => {},
      },
    });
    expect(getStoredNetworkMode()).toBe('mainnet');
  });

  it('falls back to testnet for unknown stored values', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => 'devnet',
        setItem: () => {},
      },
    });
    expect(getStoredNetworkMode()).toBe('testnet');
  });

  it('ignores localStorage exceptions when reading or writing', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(getStoredNetworkMode()).toBe('testnet');
    expect(() => setStoredNetworkMode('mainnet')).not.toThrow();
  });

  it('persists the chosen network mode when localStorage is available', () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem,
      },
    });
    setStoredNetworkMode('mainnet');
    expect(setItem).toHaveBeenCalledWith(NETWORK_MODE_STORAGE_KEY, 'mainnet');
  });

  it('parses ?network=mainnet|testnet case-insensitively and ignores invalid values', () => {
    expect(getUrlNetworkMode('?network=mainnet')).toBe('mainnet');
    expect(getUrlNetworkMode('?foo=bar&network=TESTNET')).toBe('testnet');
    expect(getUrlNetworkMode('?network=devnet')).toBeNull();
    expect(getUrlNetworkMode('')).toBeNull();
  });

  it('prefers the URL query parameter over localStorage in getInitialNetworkMode', () => {
    vi.stubGlobal('window', {
      location: { search: '?network=mainnet' },
      localStorage: {
        getItem: () => 'testnet',
        setItem: () => {},
      },
    });
    expect(getInitialNetworkMode()).toBe('mainnet');

    vi.stubGlobal('window', {
      location: { search: '?network=testnet' },
      localStorage: {
        getItem: () => 'mainnet',
        setItem: () => {},
      },
    });
    expect(getInitialNetworkMode()).toBe('testnet');
  });

  it('builds network-qualified routes cleanly', () => {
    expect(withNetworkQuery('/runs/abc', 'mainnet')).toBe('/runs/abc?network=mainnet');
    expect(withNetworkQuery('/runs/abc', 'testnet')).toBe('/runs/abc');
    expect(withNetworkQuery('/runs/abc', 'testnet', true)).toBe('/runs/abc?network=testnet');
    expect(withNetworkQuery('/account?credit=reactive', 'mainnet')).toBe(
      '/account?credit=reactive&network=mainnet',
    );
    expect(withNetworkQuery('/runs/abc?network=testnet', 'mainnet')).toBe(
      '/runs/abc?network=mainnet',
    );
    expect(withNetworkQuery('/runs/abc?network=mainnet', 'testnet')).toBe('/runs/abc');
  });
});
