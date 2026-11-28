import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { parseEther, parseGwei } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUseAccount,
  mockUseNetworkMode,
  mockConfiguredFundsChains,
  mockUseWorkflowCredits,
  mockGetGasPrice,
} = vi.hoisted(() => ({
  mockUseAccount: vi.fn(),
  mockUseNetworkMode: vi.fn(),
  mockConfiguredFundsChains: vi.fn((mode: 'testnet' | 'mainnet' = 'testnet') =>
    mode === 'mainnet' ? [130] : [1301, 84532],
  ),
  mockUseWorkflowCredits: vi.fn(),
  mockGetGasPrice: vi.fn(),
}));

vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wagmi')>();
  return {
    ...actual,
    useAccount: () => mockUseAccount(),
  };
});

vi.mock('../src/lib/networkMode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/networkMode.js')>();
  return {
    ...actual,
    useNetworkMode: () => mockUseNetworkMode(),
  };
});

vi.mock('../src/workflows/chainV2.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workflows/chainV2.js')>();
  return {
    ...actual,
    settlementFactory: () => undefined,
    configuredFundsChains: (...args: Parameters<typeof actual.configuredFundsChains>) =>
      mockConfiguredFundsChains(...args),
    workflowClient: (chain: number) => ({
      getGasPrice: () => mockGetGasPrice(chain),
      readContract: async ({ functionName }: { functionName: string }) => {
        const watching = chain === LASNA_CHAIN_ID || chain === REACTIVE_MAINNET_CHAIN_ID;
        return functionName === '_extraGas'
          ? watching
            ? 100_000n
            : 80_000n
          : watching
            ? 1000n
            : 1100n;
      },
    }),
  };
});

vi.mock('../src/workflows/WorkflowCredit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workflows/WorkflowCredit.js')>();
  return {
    ...actual,
    useWorkflowCredits: (...args: Parameters<typeof actual.useWorkflowCredits>) =>
      mockUseWorkflowCredits(...args),
  };
});

import { AccountFundingStep } from '../src/components/AccountFundingStep.js';
import type { SetupFundingBalances, SetupFundingWallet } from '../src/hooks/useAccountFunding.js';
import { buildNetworkModeState } from '../src/lib/networkMode.js';
import { creditFaucetFor, testnetFaucetsFor, usdcFaucetFor } from '../src/lib/testnetTokens.js';
import { formatDisplayGasPrice } from '../src/workflows/useGasPrices.js';
import { WorkflowCost } from '../src/workflows/WorkflowCost.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const SYSTEM = '0x1111111111111111111111111111111111111111' as const;
const PROXY = '0x2222222222222222222222222222222222222222' as const;
const USDC = '0x3333333333333333333333333333333333333333' as const;
const TX = `0x${'1'.repeat(64)}` as const;

function makeFunds(overrides: Partial<SetupFundingBalances> = {}): SetupFundingBalances {
  return {
    agent: AGENT,
    vault: VAULT,
    proxy: PROXY,
    lasnaSystem: SYSTEM,
    usdc: USDC,
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

function makeFundingWallet(funds: SetupFundingBalances = makeFunds()): SetupFundingWallet {
  return {
    readFunds: vi.fn(async () => funds),
    depositWatchingCredit: vi.fn(async () => TX),
    depositExecutionCredit: vi.fn(async () => TX),
    depositUsdc: vi.fn(async () => TX),
  };
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('testnetTokens helpers & gas formatting', () => {
  it('returns testnet faucets for testnet chains and undefined on mainnet', () => {
    expect(creditFaucetFor(LASNA_CHAIN_ID)?.linkLabel).toBe('Get Lasna lREACT');
    expect(creditFaucetFor(UNICHAIN_SEPOLIA_CHAIN_ID)?.linkLabel).toBe('Get Unichain Sepolia ETH');
    expect(creditFaucetFor(BASE_SEPOLIA_CHAIN_ID)?.linkLabel).toBe('Get Base Sepolia ETH');

    expect(usdcFaucetFor(UNICHAIN_SEPOLIA_CHAIN_ID)?.linkLabel).toBe('Get Unichain Sepolia USDC');
    expect(usdcFaucetFor(BASE_SEPOLIA_CHAIN_ID)?.linkLabel).toBe('Get Base Sepolia USDC');

    expect(testnetFaucetsFor(UNICHAIN_SEPOLIA_CHAIN_ID).map((item) => item.linkLabel)).toEqual([
      'Get Lasna lREACT',
      'Get Unichain Sepolia ETH',
      'Get Unichain Sepolia USDC',
    ]);
    expect(testnetFaucetsFor(BASE_SEPOLIA_CHAIN_ID).map((item) => item.linkLabel)).toEqual([
      'Get Lasna lREACT',
      'Get Base Sepolia ETH',
      'Get Base Sepolia USDC',
    ]);

    expect(creditFaucetFor(REACTIVE_MAINNET_CHAIN_ID)).toBeUndefined();
    expect(creditFaucetFor(UNICHAIN_MAINNET_CHAIN_ID)).toBeUndefined();
    expect(creditFaucetFor(BASE_MAINNET_CHAIN_ID)).toBeUndefined();
    expect(usdcFaucetFor(UNICHAIN_MAINNET_CHAIN_ID)).toBeUndefined();
    expect(usdcFaucetFor(BASE_MAINNET_CHAIN_ID)).toBeUndefined();
    expect(testnetFaucetsFor(UNICHAIN_MAINNET_CHAIN_ID)).toEqual([]);
    expect(testnetFaucetsFor(BASE_MAINNET_CHAIN_ID)).toEqual([]);
  });

  it('formats gas prices cleanly across L1 and L2 ranges', () => {
    expect(formatDisplayGasPrice(0n)).toBe('0');
    expect(formatDisplayGasPrice(50_000n)).toBe('< 0.0001');
    expect(formatDisplayGasPrice(parseGwei('0.001'))).toBe('0.001');
    expect(formatDisplayGasPrice(parseGwei('2.5'))).toBe('2.5');
    expect(formatDisplayGasPrice(parseGwei('15.1234'))).toBe('15.12');
  });
});

describe('WorkflowCost runway & testnet faucets', () => {
  beforeEach(() => {
    mockUseAccount.mockReset();
    mockUseNetworkMode.mockReset();
    mockConfiguredFundsChains.mockReset();
    mockUseWorkflowCredits.mockReset();
    mockGetGasPrice.mockReset();

    mockUseAccount.mockReturnValue({ address: undefined });
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      configuredFundsChains: [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });
    mockConfiguredFundsChains.mockReturnValue([UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]);
    mockUseWorkflowCredits.mockReturnValue({
      queries: [],
    });
    mockGetGasPrice.mockImplementation(async (chain: number) => {
      if (chain === LASNA_CHAIN_ID) return parseGwei('2');
      if (chain === UNICHAIN_SEPOLIA_CHAIN_ID) return parseGwei('0.1');
      if (chain === BASE_SEPOLIA_CHAIN_ID) return parseGwei('0.05');
      return parseGwei('1');
    });
  });

  it('shows suggested-reserve runway estimates and all testnet faucet links when disconnected', async () => {
    renderWithQuery(<WorkflowCost />);

    const watchingLane = screen.getByRole('region', { name: 'Watching credit' });
    const unichainLane = screen.getByRole('region', {
      name: 'Execution credit (Unichain Sepolia)',
    });
    const baseLane = screen.getByRole('region', { name: 'Execution credit (Base Sepolia)' });

    await waitFor(() => {
      expect(within(watchingLane).getByText('~83 runs covered')).toBeInTheDocument();
      expect(within(unichainLane).getByText('~2 runs covered')).toBeInTheDocument();
      expect(within(baseLane).getByText('~4 runs covered')).toBeInTheDocument();
    });

    const faucetLinks = [
      'Get Lasna lREACT',
      'Get Unichain Sepolia ETH',
      'Get Base Sepolia ETH',
      'Get Unichain Sepolia USDC',
      'Get Base Sepolia USDC',
    ];
    for (const label of faucetLinks) {
      const link = screen.getByRole('link', { name: new RegExp(label) });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });

  it('uses connected wallet reserves net of debt and surfaces honest status badges', async () => {
    mockUseAccount.mockReturnValue({ address: OWNER });
    mockUseWorkflowCredits.mockReturnValue({
      queries: [
        { data: { reserve: parseEther('0.1'), debt: 0n, blockNumber: 1n } },
        {
          data: {
            reserve: 0n,
            debt: parseEther('0.00005'),
            blockNumber: 1n,
          },
        },
        { data: { reserve: 0n, debt: 0n, blockNumber: 1n } },
      ],
    });

    renderWithQuery(<WorkflowCost />);

    const watchingLane = screen.getByRole('region', { name: 'Watching credit' });
    const unichainLane = screen.getByRole('region', {
      name: 'Execution credit (Unichain Sepolia)',
    });
    const baseLane = screen.getByRole('region', { name: 'Execution credit (Base Sepolia)' });

    await waitFor(() => {
      expect(within(watchingLane).getByText('~166 runs covered')).toBeInTheDocument();
      expect(within(watchingLane).getByText('Funded')).toBeInTheDocument();
      expect(within(watchingLane).getByText('Your reserve')).toBeInTheDocument();

      expect(within(unichainLane).getByText('0 runs covered')).toBeInTheDocument();
      expect(within(unichainLane).getByText('Fees due')).toBeInTheDocument();

      expect(within(baseLane).getByText('0 runs covered')).toBeInTheDocument();
      expect(within(baseLane).getByText('Unfunded')).toBeInTheDocument();
    });
  });

  it('hides all testnet faucet links in mainnet mode and handles unavailable gas gracefully', async () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      configuredFundsChains: [UNICHAIN_MAINNET_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });
    mockConfiguredFundsChains.mockReturnValue([UNICHAIN_MAINNET_CHAIN_ID]);
    mockGetGasPrice.mockImplementation(async (chain: number) => {
      if (chain === REACTIVE_MAINNET_CHAIN_ID) return parseGwei('2');
      throw new Error('RPC offline');
    });

    renderWithQuery(<WorkflowCost />);

    const watchingLane = screen.getByRole('region', { name: 'Watching credit' });
    const unichainLane = screen.getByRole('region', { name: 'Execution credit (Unichain)' });

    await waitFor(() => {
      expect(within(watchingLane).getByText('~833 runs covered')).toBeInTheDocument();
      expect(within(unichainLane).getByText('Runway unavailable')).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: /Get Lasna/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Get Unichain/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Get Base/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Need testnet tokens for your vault?')).not.toBeInTheDocument();
  });
});

describe('AccountFundingStep live runway & faucets', () => {
  beforeEach(() => {
    mockUseAccount.mockReturnValue({ address: OWNER, connector: { uid: 'test-wallet' } });
    mockGetGasPrice.mockImplementation(async (chain: number) => {
      if (chain === LASNA_CHAIN_ID || chain === REACTIVE_MAINNET_CHAIN_ID) return parseGwei('2');
      return parseGwei('0.1');
    });
  });

  it('shows live runway that updates as the user edits deposit amounts and renders testnet faucets', async () => {
    const fundingWallet = makeFundingWallet();
    renderWithQuery(
      <AccountFundingStep
        owner={OWNER}
        chainId={UNICHAIN_SEPOLIA_CHAIN_ID}
        fundingWallet={fundingWallet}
        onComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('~166 runs covered')).toBeInTheDocument();
      expect(screen.getByText('~21 runs covered')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /Get Lasna lREACT/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Get Unichain Sepolia ETH/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Get Unichain Sepolia USDC/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Watching credit (lREACT)'), {
      target: { value: '0.2' },
    });
    expect(screen.getByText('~333 runs covered')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Watching credit (lREACT)'), {
      target: { value: '' },
    });
    expect(screen.getByText('Suggested 0.1 lREACT')).toBeInTheDocument();
    expect(
      screen.getByText('Covers ~166 runs at live gas · ~200k gas per trigger check'),
    ).toBeInTheDocument();
  });

  it('counts only the portion of a deposit left after outstanding fees', async () => {
    const fundingWallet = makeFundingWallet(makeFunds({ watchDebt: parseEther('0.15') }));
    renderWithQuery(
      <AccountFundingStep
        owner={OWNER}
        chainId={UNICHAIN_SEPOLIA_CHAIN_ID}
        fundingWallet={fundingWallet}
        onComplete={vi.fn()}
      />,
    );

    expect(await screen.findByText('0 runs covered')).toBeInTheDocument();
    expect(screen.getByText('Fees due: 0.15 lREACT. Deposits pay fees first.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Watching credit (lREACT)'), {
      target: { value: '0.2' },
    });
    expect(screen.getByText('~83 runs covered')).toBeInTheDocument();
  });

  it('hides testnet faucets on mainnet funding', async () => {
    const fundingWallet = makeFundingWallet();
    renderWithQuery(
      <AccountFundingStep
        owner={OWNER}
        chainId={UNICHAIN_MAINNET_CHAIN_ID}
        fundingWallet={fundingWallet}
        onComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Watching credit (REACT)')).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: /Get Lasna/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Get Unichain/i })).not.toBeInTheDocument();
  });
});
