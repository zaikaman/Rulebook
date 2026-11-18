import type { Address } from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useAccountSetup, type SetupWallet } from '../src/hooks/useAccountSetup.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;

function makeWallet(initial: { agent?: Address; vault?: Address; link?: Address } = {}) {
  const state = { ...initial };
  return {
    getAgent: vi.fn(async () => state.agent ?? null),
    getVault: vi.fn(async () => state.vault ?? null),
    getLink: vi.fn(async () => state.link ?? null),
    getVaultAgent: vi.fn(async () => AGENT),
    createAgent: vi.fn(async () => (state.agent = AGENT)),
    createVault: vi.fn(async () => (state.vault = VAULT)),
    linkVault: vi.fn(async () => {
      state.link = VAULT;
    }),
  } satisfies SetupWallet;
}

function renderSetup(wallet: SetupWallet) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useAccountSetup({ owner: OWNER, wallet }), { wrapper });
}

describe('useAccountSetup', () => {
  it('creates and links both accounts in order from one action', async () => {
    const wallet = makeWallet();
    const { result } = renderSetup(wallet);

    act(() => result.current.resume('mirror'));

    await waitFor(() =>
      expect(result.current.data).toEqual({ agent: AGENT, vault: VAULT, linked: true }),
    );
    expect(wallet.createAgent).toHaveBeenCalledWith(OWNER);
    expect(wallet.createVault).toHaveBeenCalledWith(OWNER, AGENT, 'mirror');
    expect(wallet.linkVault).toHaveBeenCalledWith(AGENT, VAULT, 1301);
    expect(wallet.createAgent).toHaveBeenCalledBefore(wallet.createVault);
    expect(wallet.createVault).toHaveBeenCalledBefore(wallet.linkVault);
  });

  it('retries only the missing steps after a wallet rejection', async () => {
    const wallet = makeWallet();
    wallet.createVault.mockRejectedValueOnce(new Error('Request rejected.'));
    const { result } = renderSetup(wallet);

    act(() => result.current.resume());
    await waitFor(() => expect(result.current.setupError?.message).toBe('Request rejected.'));
    expect(result.current.data?.agent).toBe(AGENT);
    expect(wallet.linkVault).not.toHaveBeenCalled();

    act(() => result.current.resume());
    await waitFor(() => expect(result.current.data?.linked).toBe(true));
    expect(wallet.createAgent).toHaveBeenCalledTimes(1);
    expect(wallet.createVault).toHaveBeenCalledTimes(2);
    expect(wallet.linkVault).toHaveBeenCalledTimes(1);
  });

  it('opens a completed account without requesting another signature', async () => {
    const wallet = makeWallet({ agent: AGENT, vault: VAULT, link: VAULT });
    const { result } = renderSetup(wallet);

    await waitFor(() => expect(result.current.data?.linked).toBe(true));
    expect(wallet.createAgent).not.toHaveBeenCalled();
    expect(wallet.createVault).not.toHaveBeenCalled();
    expect(wallet.linkVault).not.toHaveBeenCalled();
  });
});
