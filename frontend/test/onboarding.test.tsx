import type { Account, Address } from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  useAccountSetup,
  type AccountSetupApi,
  type SetupWallet,
} from '../src/hooks/useAccountSetup.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
const HASH = `0x${'1'.repeat(64)}` as const;

const agentOnly: Account = {
  owner: OWNER,
  agent: { address: AGENT, created_tx: HASH, active_rules: 0 },
  vaults: [],
  setup_state: 'agent_only',
};

const complete: Account = {
  ...agentOnly,
  vaults: [
    {
      address: VAULT,
      chain_id: 1301,
      connected: true,
      paused: false,
      mirror_mode: false,
    },
  ],
  setup_state: 'complete',
};

function wrapper({ children }: { readonly children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeApi(account: Account) {
  return {
    account: vi.fn(async () => account),
    onboarding: vi.fn(async () => ({
      setup_state: 'partial' as const,
      agent: AGENT,
      vault: VAULT,
      steps: [
        { name: 'agent' as const, status: 'skipped' as const, chain_id: 5_318_007 },
        {
          name: 'vault' as const,
          status: 'confirmed' as const,
          tx_hash: HASH,
          chain_id: 1301,
        },
        {
          name: 'link' as const,
          status: 'skipped' as const,
          chain_id: 5_318_007,
          error: 'owner_signature_required',
        },
      ],
    })),
    starterFunds: vi.fn(async () => ({
      tx_hash: HASH,
      amount_usdc: 10_000_000n,
      amount_weth: 10_000_000_000_000_000n,
    })),
  } satisfies AccountSetupApi;
}

function makeWallet() {
  return {
    address: OWNER,
    chainId: 1301,
    getAgent: vi.fn(async () => AGENT),
    getVault: vi.fn(async () => null),
    switchToLasna: vi.fn(async () => undefined),
    linkVault: vi.fn(async () => HASH),
  } satisfies SetupWallet;
}

describe('useAccountSetup', () => {
  it('reports agent_only and resumes only the missing vault/link step', async () => {
    const api = makeApi(agentOnly);
    const wallet = makeWallet();
    const { result } = renderHook(() => useAccountSetup({ owner: OWNER, api, wallet }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.setupState).toBe('agent_only'));

    await act(async () => {
      await result.current.resume();
    });

    expect(api.onboarding).toHaveBeenCalledTimes(1);
    expect(api.onboarding).toHaveBeenCalledWith(OWNER);
    expect(wallet.switchToLasna).toHaveBeenCalledTimes(1);
    expect(wallet.linkVault).toHaveBeenCalledTimes(1);
    expect(wallet.linkVault).toHaveBeenCalledWith(AGENT, VAULT, 1301);
    expect(api.starterFunds).not.toHaveBeenCalled();
  });

  it('never restarts a completed account', async () => {
    const api = makeApi(complete);
    const wallet = makeWallet();
    const { result } = renderHook(() => useAccountSetup({ owner: OWNER, api, wallet }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.setupState).toBe('complete'));

    await act(async () => {
      await result.current.resume();
    });

    expect(api.onboarding).not.toHaveBeenCalled();
    expect(wallet.linkVault).not.toHaveBeenCalled();
  });
});
