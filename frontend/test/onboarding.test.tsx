import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import {
  defaultFundingAmounts,
  parseFundingAmount,
  useAccountFunding,
  type SetupFundingBalances,
  type SetupFundingWallet,
} from '../src/hooks/useAccountFunding.js';
import { useAccountSetup, type SetupStep, type SetupWallet } from '../src/hooks/useAccountSetup.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const connectorUid = 'reviewed-wallet';
const allSteps: readonly SetupStep[] = ['agent', 'vault', 'link'];

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

    act(() => result.current.resume({ steps: allSteps, connectorUid, mode: 'mirror' }));

    await waitFor(() =>
      expect(result.current.data).toEqual({ agent: AGENT, vault: VAULT, linked: true }),
    );
    expect(wallet.createAgent).toHaveBeenCalledWith(OWNER, connectorUid);
    expect(wallet.createVault).toHaveBeenCalledWith(OWNER, AGENT, connectorUid, 'mirror');
    expect(wallet.linkVault).toHaveBeenCalledWith(OWNER, AGENT, VAULT, 1301, connectorUid);
    expect(wallet.createAgent).toHaveBeenCalledBefore(wallet.createVault);
    expect(wallet.createVault).toHaveBeenCalledBefore(wallet.linkVault);
  });

  it('retries only the missing steps after a wallet rejection', async () => {
    const wallet = makeWallet();
    wallet.createVault.mockRejectedValueOnce(new Error('Request rejected.'));
    const { result } = renderSetup(wallet);

    act(() => result.current.resume({ steps: allSteps, connectorUid }));
    await waitFor(() => expect(result.current.setupError?.message).toBe('Request rejected.'));
    expect(result.current.data?.agent).toBe(AGENT);
    expect(wallet.linkVault).not.toHaveBeenCalled();

    act(() => result.current.resume({ steps: ['vault', 'link'], connectorUid }));
    await waitFor(() => expect(result.current.data?.linked).toBe(true));
    expect(wallet.createAgent).toHaveBeenCalledTimes(1);
    expect(wallet.createVault).toHaveBeenCalledTimes(2);
    expect(wallet.linkVault).toHaveBeenCalledTimes(1);
  });

  it('requests a fresh review if the wallet needs a step that was absent from the review', async () => {
    const wallet = makeWallet({ agent: AGENT });
    const { result } = renderSetup(wallet);
    await waitFor(() => expect(result.current.data?.agent).toBe(AGENT));
    wallet.getAgent.mockResolvedValue(null);

    act(() => result.current.resume({ steps: ['vault', 'link'], connectorUid }));

    await waitFor(() => expect(result.current.setupError?.message).toMatch(/steps changed/));
    expect(wallet.createAgent).not.toHaveBeenCalled();
    expect(wallet.createVault).not.toHaveBeenCalled();
    expect(wallet.linkVault).not.toHaveBeenCalled();
  });

  it('opens a completed account without requesting another signature', async () => {
    const wallet = makeWallet({ agent: AGENT, vault: VAULT, link: VAULT });
    const { result } = renderSetup(wallet);

    await waitFor(() => expect(result.current.data?.linked).toBe(true));
    expect(wallet.createAgent).not.toHaveBeenCalled();
    expect(wallet.createVault).not.toHaveBeenCalled();
    expect(wallet.linkVault).not.toHaveBeenCalled();
  });

  it('links the Vault on Base Sepolia when chainId is BASE_SEPOLIA_CHAIN_ID', async () => {
    const wallet = makeWallet();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function wrapper({ children }: { readonly children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(
      () => useAccountSetup({ owner: OWNER, wallet, chainId: BASE_SEPOLIA_CHAIN_ID }),
      { wrapper },
    );
    act(() => result.current.resume({ steps: allSteps, connectorUid }));
    await waitFor(() => expect(result.current.data?.linked).toBe(true));
    expect(wallet.linkVault).toHaveBeenCalledWith(
      OWNER,
      AGENT,
      VAULT,
      BASE_SEPOLIA_CHAIN_ID,
      connectorUid,
    );
  });
});

const SYSTEM_CONTRACT = '0x1111111111111111111111111111111111111111' as const;
const CALLBACK_PROXY = '0x2222222222222222222222222222222222222222' as const;
const USDC_TOKEN = '0x3333333333333333333333333333333333333333' as const;
const TX_1 = `0x${'1'.repeat(64)}` as const;
const TX_2 = `0x${'2'.repeat(64)}` as const;
const TX_3 = `0x${'3'.repeat(64)}` as const;

function makeFunds(overrides: Partial<SetupFundingBalances> = {}): SetupFundingBalances {
  return {
    agent: AGENT,
    vault: VAULT,
    proxy: CALLBACK_PROXY,
    lasnaSystem: SYSTEM_CONTRACT,
    usdc: USDC_TOKEN,
    watch: 0n,
    execution: 0n,
    watchDebt: 0n,
    executionDebt: 0n,
    stable: 0n,
    walletWatch: parseEther('1'),
    walletNative: parseEther('0.1'),
    walletStable: 25_000_000n,
    ...overrides,
  };
}

function makeFundingWallet(funds: SetupFundingBalances = makeFunds()) {
  return {
    readFunds: vi.fn(async () => funds),
    depositWatchingCredit: vi.fn(async () => TX_1),
    depositExecutionCredit: vi.fn(async () => TX_2),
    depositUsdc: vi.fn(async () => TX_3),
  } satisfies SetupFundingWallet;
}

function renderFunding(fundingWallet: SetupFundingWallet) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(
    () =>
      useAccountFunding({
        owner: OWNER,
        chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
        fundingWallet,
      }),
    { wrapper },
  );
}

describe('defaultFundingAmounts', () => {
  it('suggests starter credits and 10 USDC when wallet balances cover buffers', () => {
    expect(defaultFundingAmounts(makeFunds(), UNICHAIN_SEPOLIA_CHAIN_ID)).toEqual({
      watching: '0.1',
      execution: '0.001',
      usdc: '10',
    });
  });

  it('caps USDC to wallet balance when below 10 USDC and leaves blank when zero', () => {
    expect(
      defaultFundingAmounts(makeFunds({ walletStable: 4_500_000n }), UNICHAIN_SEPOLIA_CHAIN_ID),
    ).toEqual({
      watching: '0.1',
      execution: '0.001',
      usdc: '4.5',
    });
    expect(
      defaultFundingAmounts(makeFunds({ walletStable: 0n }), UNICHAIN_SEPOLIA_CHAIN_ID),
    ).toEqual({
      watching: '0.1',
      execution: '0.001',
      usdc: '',
    });
  });

  it('skips already-funded reserves and respects gas buffers on small balances', () => {
    expect(
      defaultFundingAmounts(
        makeFunds({
          watch: parseEther('0.05'),
          execution: parseEther('0.0001'),
          stable: 1_000_000n,
        }),
        UNICHAIN_SEPOLIA_CHAIN_ID,
      ),
    ).toEqual({
      watching: '',
      execution: '',
      usdc: '',
    });

    expect(
      defaultFundingAmounts(
        makeFunds({
          walletWatch: parseEther('0.056'),
          walletNative: parseEther('0.0003'),
        }),
        UNICHAIN_SEPOLIA_CHAIN_ID,
      ),
    ).toEqual({
      watching: '0.05',
      execution: '0.0001',
      usdc: '10',
    });

    expect(
      defaultFundingAmounts(
        makeFunds({
          walletWatch: parseEther('0.01'),
          walletNative: parseEther('0.0002'),
        }),
        UNICHAIN_SEPOLIA_CHAIN_ID,
      ),
    ).toEqual({
      watching: '',
      execution: '',
      usdc: '10',
    });
  });

  it('uses higher gas buffers and starter defaults for Reactive Mainnet and mainnet settlement chains', () => {
    // Holding 0.605 REACT with the 0.05 REACT Reactive Mainnet buffer leaves 0.555 REACT
    // (above the 0.5 REACT minimum warning threshold and below the 1 REACT starter default).
    expect(
      defaultFundingAmounts(
        makeFunds({
          walletWatch: parseEther('0.605'),
          walletNative: parseEther('0.005'),
          walletStable: 25_000_000n,
        }),
        UNICHAIN_MAINNET_CHAIN_ID,
      ),
    ).toEqual({
      watching: '0.5',
      execution: '0.003',
      usdc: '10',
    });

    // When wallet balances exceed starter thresholds, mainnet defaults to 1 REACT and 0.003 ETH.
    expect(
      defaultFundingAmounts(
        makeFunds({
          walletWatch: parseEther('2'),
          walletNative: parseEther('0.01'),
          walletStable: 25_000_000n,
        }),
        BASE_MAINNET_CHAIN_ID,
      ),
    ).toEqual({
      watching: '1',
      execution: '0.003',
      usdc: '10',
    });

    // Holding only 0.54 REACT on Reactive Mainnet leaves 0.49 REACT after the 0.05 REACT buffer,
    // which is below the 0.5 REACT minimum, so it skips auto-filling instead of dipping into gas.
    expect(
      defaultFundingAmounts(
        makeFunds({
          walletWatch: parseEther('0.54'),
          walletNative: parseEther('0.0005'),
        }),
        UNICHAIN_MAINNET_CHAIN_ID,
      ),
    ).toEqual({
      watching: '',
      execution: '',
      usdc: '10',
    });
  });
});

describe('parseFundingAmount', () => {
  it('treats blank values as skipped and rejects zero, invalid, or excess amounts', () => {
    expect(parseFundingAmount('   ', 6, 'USDC', 10_000_000n)).toEqual({});
    expect(parseFundingAmount('0', 6, 'USDC', 10_000_000n).error).toMatch(/positive/i);
    expect(parseFundingAmount('-1', 6, 'USDC', 10_000_000n).error).toBeTruthy();
    expect(parseFundingAmount('11', 6, 'USDC', 10_000_000n).error).toMatch(/at most 10 USDC/i);
    expect(parseFundingAmount('10', 6, 'USDC', 10_000_000n)).toEqual({ amount: 10_000_000n });
  });
});

describe('useAccountFunding', () => {
  it('deposits watching credit, execution credit, and USDC in order from one action', async () => {
    const funds = makeFunds();
    const fundingWallet = makeFundingWallet(funds);
    const { result } = renderFunding(fundingWallet);

    await waitFor(() => expect(result.current.fundsQuery.data).toEqual(funds));

    act(() =>
      result.current.deposit({
        connectorUid,
        funds,
        plan: [
          {
            id: 'watching',
            amount: parseEther('0.1'),
            display: '0.1 lREACT',
            chainId: LASNA_CHAIN_ID,
            label: 'Deposit 0.1 lREACT for watching credit',
            networkName: 'Reactive Lasna',
          },
          {
            id: 'execution',
            amount: parseEther('0.001'),
            display: '0.001 ETH',
            chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
            label: 'Deposit 0.001 ETH for execution credit',
            networkName: 'Unichain Sepolia',
          },
          {
            id: 'usdc',
            amount: 10_000_000n,
            display: '10 USDC',
            chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
            label: 'Deposit 10 USDC to your vault',
            networkName: 'Unichain Sepolia',
          },
        ],
      }),
    );

    await waitFor(() =>
      expect(result.current.confirmed).toEqual({
        watching: TX_1,
        execution: TX_2,
        usdc: TX_3,
      }),
    );
    expect(fundingWallet.depositWatchingCredit).toHaveBeenCalledWith(
      OWNER,
      AGENT,
      SYSTEM_CONTRACT,
      parseEther('0.1'),
      connectorUid,
    );
    expect(fundingWallet.depositExecutionCredit).toHaveBeenCalledWith(
      OWNER,
      VAULT,
      CALLBACK_PROXY,
      UNICHAIN_SEPOLIA_CHAIN_ID,
      parseEther('0.001'),
      connectorUid,
    );
    expect(fundingWallet.depositUsdc).toHaveBeenCalledWith(
      OWNER,
      VAULT,
      USDC_TOKEN,
      UNICHAIN_SEPOLIA_CHAIN_ID,
      10_000_000n,
      connectorUid,
    );
    expect(fundingWallet.depositWatchingCredit).toHaveBeenCalledBefore(
      fundingWallet.depositExecutionCredit,
    );
    expect(fundingWallet.depositExecutionCredit).toHaveBeenCalledBefore(fundingWallet.depositUsdc);
  });

  it('preserves confirmed deposits and only retries remaining steps after a rejection', async () => {
    const funds = makeFunds();
    const fundingWallet = makeFundingWallet(funds);
    fundingWallet.depositExecutionCredit.mockRejectedValueOnce(new Error('Request rejected.'));
    const { result } = renderFunding(fundingWallet);

    await waitFor(() => expect(result.current.fundsQuery.data).toEqual(funds));

    const plan = [
      {
        id: 'watching' as const,
        amount: parseEther('0.1'),
        display: '0.1 lREACT',
        chainId: LASNA_CHAIN_ID,
        label: 'Deposit 0.1 lREACT for watching credit',
        networkName: 'Reactive Lasna',
      },
      {
        id: 'execution' as const,
        amount: parseEther('0.001'),
        display: '0.001 ETH',
        chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
        label: 'Deposit 0.001 ETH for execution credit',
        networkName: 'Unichain Sepolia',
      },
      {
        id: 'usdc' as const,
        amount: 10_000_000n,
        display: '10 USDC',
        chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
        label: 'Deposit 10 USDC to your vault',
        networkName: 'Unichain Sepolia',
      },
    ];

    act(() => result.current.deposit({ connectorUid, funds, plan }));
    await waitFor(() => expect(result.current.depositError?.message).toBe('Request rejected.'));
    expect(result.current.confirmed).toEqual({ watching: TX_1 });
    expect(result.current.failedItem).toBe('execution');
    expect(fundingWallet.depositUsdc).not.toHaveBeenCalled();

    act(() => result.current.deposit({ connectorUid, funds, plan }));
    await waitFor(() =>
      expect(result.current.confirmed).toEqual({
        watching: TX_1,
        execution: TX_2,
        usdc: TX_3,
      }),
    );
    expect(fundingWallet.depositWatchingCredit).toHaveBeenCalledTimes(1);
    expect(fundingWallet.depositExecutionCredit).toHaveBeenCalledTimes(2);
    expect(fundingWallet.depositUsdc).toHaveBeenCalledTimes(1);
  });

  it('targets Base Sepolia for execution credit and USDC when configured for BASE_SEPOLIA_CHAIN_ID', async () => {
    const funds = makeFunds();
    const fundingWallet = makeFundingWallet(funds);
    expect(defaultFundingAmounts(funds, BASE_SEPOLIA_CHAIN_ID)).toEqual({
      watching: '0.1',
      execution: '0.001',
      usdc: '10',
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function wrapper({ children }: { readonly children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(
      () =>
        useAccountFunding({
          owner: OWNER,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          fundingWallet,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.fundsQuery.data).toEqual(funds));

    act(() =>
      result.current.deposit({
        connectorUid,
        funds,
        plan: [
          {
            id: 'execution',
            amount: parseEther('0.001'),
            display: '0.001 ETH',
            chainId: BASE_SEPOLIA_CHAIN_ID,
            label: 'Deposit 0.001 ETH for execution credit',
            networkName: 'Base Sepolia',
          },
          {
            id: 'usdc',
            amount: 10_000_000n,
            display: '10 USDC',
            chainId: BASE_SEPOLIA_CHAIN_ID,
            label: 'Deposit 10 USDC to your vault',
            networkName: 'Base Sepolia',
          },
        ],
      }),
    );

    await waitFor(() =>
      expect(result.current.confirmed).toEqual({
        execution: TX_2,
        usdc: TX_3,
      }),
    );
    expect(fundingWallet.depositExecutionCredit).toHaveBeenCalledWith(
      OWNER,
      VAULT,
      CALLBACK_PROXY,
      BASE_SEPOLIA_CHAIN_ID,
      parseEther('0.001'),
      connectorUid,
    );
    expect(fundingWallet.depositUsdc).toHaveBeenCalledWith(
      OWNER,
      VAULT,
      USDC_TOKEN,
      BASE_SEPOLIA_CHAIN_ID,
      10_000_000n,
      connectorUid,
    );
  });
});
