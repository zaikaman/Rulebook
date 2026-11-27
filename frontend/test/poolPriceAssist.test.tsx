import {
  BASE_SEPOLIA_CHAIN_ID,
  getFundsChain,
  LASNA_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { zeroAddress } from 'viem';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPublicClientFor, mockUseNetworkMode } = vi.hoisted(() => ({
  mockPublicClientFor: vi.fn(),
  mockUseNetworkMode: vi.fn(),
}));

vi.mock('../src/lib/wagmi.js', () => ({
  publicClientFor: mockPublicClientFor,
}));

vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wagmi')>();
  return {
    ...actual,
    useAccount: () => ({ address: undefined }),
    useSendTransaction: () => ({ sendTransactionAsync: vi.fn() }),
  };
});

vi.mock('../src/lib/networkMode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/networkMode.js')>();
  return {
    ...actual,
    useNetworkMode: () => mockUseNetworkMode(),
  };
});

vi.mock('../src/lib/contracts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/contracts.js')>();
  const agentFactory = '0x1111111111111111111111111111111111111111' as const;
  const unichainFactory = '0x2222222222222222222222222222222222222222' as const;
  const baseFactory = '0x3333333333333333333333333333333333333333' as const;
  const deployment = {
    mode: 'testnet' as const,
    automationChainId: 5_318_007 as const,
    automationFactory: agentFactory,
    unichain: { chainId: 1301 as const, factory: unichainFactory, startBlock: 1 },
    base: { chainId: 84532 as const, factory: baseFactory, startBlock: 1 },
  };
  return {
    ...actual,
    configuredFundsChainsFor: () => [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
    resolveWorkflowV2Deployment: () => deployment,
  };
});

import { buildNetworkModeState } from '../src/lib/networkMode.js';
import { WorkflowBuilderV2 } from '../src/workflows/BuilderV2.js';
import { readPoolSpotPrice } from '../src/workflows/chainV2.js';
import { PoolPriceAssist } from '../src/workflows/PoolPriceAssist.js';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
}

function setupDefaultRpcMocks() {
  const unichain = getFundsChain(UNICHAIN_SEPOLIA_CHAIN_ID);
  const base = getFundsChain(BASE_SEPOLIA_CHAIN_ID);
  const unichainMainnet = getFundsChain(UNICHAIN_MAINNET_CHAIN_ID);

  const unichainClient = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'token0') return unichain.usdc;
      if (functionName === 'token1') return unichain.weth;
      if (functionName === 'getReserves') {
        return [250_000_000_000n, 100n * 10n ** 18n, 1_700_000_000] as const;
      }
      throw new Error(`Unexpected Unichain Sepolia call: ${functionName}`);
    }),
  };

  const baseClient = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'token0') return base.weth;
      if (functionName === 'token1') return base.usdc;
      if (functionName === 'getReserves') {
        return [100n * 10n ** 18n, 260_000_000_000n, 1_700_000_000] as const;
      }
      throw new Error(`Unexpected Base Sepolia call: ${functionName}`);
    }),
  };

  const mainnetClient = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'token0') return unichainMainnet.usdc;
      if (functionName === 'token1') return unichainMainnet.weth;
      if (functionName === 'slot0') {
        return [20_000n * (1n << 96n), 0, 0, 1, 1, 0, true] as const;
      }
      if (functionName === 'liquidity') return 500_000n;
      throw new Error(`Unexpected Unichain Mainnet call: ${functionName}`);
    }),
  };

  mockPublicClientFor.mockImplementation((chainId: number) => {
    if (chainId === LASNA_CHAIN_ID) return { readContract: vi.fn() };
    if (chainId === UNICHAIN_SEPOLIA_CHAIN_ID) return unichainClient;
    if (chainId === BASE_SEPOLIA_CHAIN_ID) return baseClient;
    if (chainId === UNICHAIN_MAINNET_CHAIN_ID) return mainnetClient;
    throw new Error(`Unexpected chainId: ${chainId}`);
  });

  return { unichainClient, baseClient, mainnetClient };
}

beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = () =>
      ({
        matches: false,
        media: '',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (typeof ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

beforeEach(() => {
  localStorage.clear();
  mockPublicClientFor.mockReset();
  mockUseNetworkMode.mockReturnValue({
    ...buildNetworkModeState('testnet'),
    isDeploymentConfigured: true,
    setMode: vi.fn(),
  });
});

describe('readPoolSpotPrice', () => {
  it('reads V2 reserves regardless of token0 order', async () => {
    setupDefaultRpcMocks();

    const uniSpot = await readPoolSpotPrice(UNICHAIN_SEPOLIA_CHAIN_ID);
    expect(uniSpot.isV3).toBe(false);
    expect(uniSpot.price).toBe(2500n * 10n ** 18n);

    const baseSpot = await readPoolSpotPrice(BASE_SEPOLIA_CHAIN_ID);
    expect(baseSpot.isV3).toBe(false);
    expect(baseSpot.price).toBe(2600n * 10n ** 18n);
  });

  it('reads V3 slot0 and liquidity when poolFee is configured', async () => {
    setupDefaultRpcMocks();

    const spot = await readPoolSpotPrice(UNICHAIN_MAINNET_CHAIN_ID);
    expect(spot.isV3).toBe(true);
    expect(spot.price).toBe(2500n * 10n ** 18n);
  });

  it('rejects zero liquidity or mismatched pair tokens on V2 and V3 pools', async () => {
    const unichain = getFundsChain(UNICHAIN_SEPOLIA_CHAIN_ID);
    const base = getFundsChain(BASE_SEPOLIA_CHAIN_ID);
    const unichainMainnet = getFundsChain(UNICHAIN_MAINNET_CHAIN_ID);
    mockPublicClientFor.mockImplementation((chainId: number) => {
      if (chainId === UNICHAIN_SEPOLIA_CHAIN_ID) {
        return {
          readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
            if (functionName === 'token0') return unichain.usdc;
            if (functionName === 'token1') return unichain.weth;
            return [0n, 100n, 0] as const;
          }),
        };
      }
      if (chainId === BASE_SEPOLIA_CHAIN_ID) {
        return {
          readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
            if (functionName === 'token0') return base.usdc;
            if (functionName === 'token1') return zeroAddress;
            return [100n, 100n, 0] as const;
          }),
        };
      }
      return {
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === 'token0') return unichainMainnet.usdc;
          if (functionName === 'token1') return unichainMainnet.weth;
          if (functionName === 'slot0')
            return [20_000n * (1n << 96n), 0, 0, 1, 1, 0, true] as const;
          return 0n;
        }),
      };
    });

    await expect(readPoolSpotPrice(UNICHAIN_SEPOLIA_CHAIN_ID)).rejects.toThrow(
      'Pool has no active liquidity.',
    );
    await expect(readPoolSpotPrice(BASE_SEPOLIA_CHAIN_ID)).rejects.toThrow(
      'Configured pair does not match USDC/WETH.',
    );
    await expect(readPoolSpotPrice(UNICHAIN_MAINNET_CHAIN_ID)).rejects.toThrow(
      'Pool has no active liquidity.',
    );
  });
});

describe('PoolPriceAssist', () => {
  it('shows loading skeleton, renders live spot, applies presets, and supports refresh', async () => {
    const { unichainClient } = setupDefaultRpcMocks();
    const client = makeQueryClient();
    const onSelect = vi.fn();

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <PoolPriceAssist chain={UNICHAIN_SEPOLIA_CHAIN_ID} value="" onSelect={onSelect} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('status', { name: 'Reading pool price' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set price to -5%/i })).toBeDisabled();

    await waitFor(() => expect(screen.getByText('2,500.00')).toBeInTheDocument());
    expect(screen.getByText('Spot · Unichain Sepolia')).toBeInTheDocument();
    expect(screen.getByText('USDC/WETH')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Set price to -5% from spot/i }));
    expect(onSelect).toHaveBeenLastCalledWith('2375');

    rerender(
      <QueryClientProvider client={client}>
        <PoolPriceAssist chain={UNICHAIN_SEPOLIA_CHAIN_ID} value="2375" onSelect={onSelect} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /Set price to -5% from spot/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('-5.0% vs spot')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Set price to spot/i }));
    expect(onSelect).toHaveBeenLastCalledWith('2500');

    const callsBefore = unichainClient.readContract.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Unichain Sepolia pool price' }));
    await waitFor(() =>
      expect(unichainClient.readContract.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it('shows an error state and retries on demand when RPC fails', async () => {
    let shouldFail = true;
    const unichain = getFundsChain(UNICHAIN_SEPOLIA_CHAIN_ID);
    mockPublicClientFor.mockReturnValue({
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (shouldFail) throw new Error('RPC offline');
        if (functionName === 'token0') return unichain.usdc;
        if (functionName === 'token1') return unichain.weth;
        return [250_000_000_000n, 100n * 10n ** 18n, 1_700_000_000] as const;
      }),
    });

    const client = makeQueryClient();
    render(
      <QueryClientProvider client={client}>
        <PoolPriceAssist chain={UNICHAIN_SEPOLIA_CHAIN_ID} value="" onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Pool price unavailable')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Set price to -5%/i })).toBeDisabled();

    shouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('2,500.00')).toBeInTheDocument());
  });
});

describe('WorkflowBuilderV2 pool price integration', () => {
  function renderNewBuilder(initialPath = '/workflows/new') {
    const client = makeQueryClient();
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/workflows/new" element={<WorkflowBuilderV2 />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders live spot and offset presets for Limit buy, Take profit, Trailing stop, and Price-band trading', async () => {
    setupDefaultRpcMocks();
    renderNewBuilder();

    const recipes = screen.getByRole('region', { name: 'Workflow recipes' });
    fireEvent.click(within(recipes).getByRole('button', { name: /Limit buy/i }));

    await waitFor(() => expect(screen.getByText('2,500.00')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Set price to -5% from spot/i }));
    expect(screen.getByLabelText('Limit price (USDC per WETH)')).toHaveValue('2375');

    // Switch Settlement network to Base Sepolia and verify live spot updates to 2,600.00.
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Base Sepolia' }));
    await waitFor(() => expect(screen.getByText('2,600.00')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Set price to -2% from spot/i }));
    expect(screen.getByLabelText('Limit price (USDC per WETH)')).toHaveValue('2548');

    // Take profit
    fireEvent.click(within(recipes).getByRole('button', { name: /Take profit/i }));
    fireEvent.click(screen.getByRole('button', { name: /Set price to \+10% from spot/i }));
    expect(screen.getByLabelText('Target price (USDC per WETH)')).toHaveValue('2860');

    // Trailing stop
    fireEvent.click(within(recipes).getByRole('button', { name: /Trailing stop/i }));
    fireEvent.click(screen.getByRole('button', { name: /Set price to -5% from spot/i }));
    expect(screen.getByLabelText('Stop price (USDC per WETH)')).toHaveValue('2470');

    // Price-band trading
    fireEvent.click(within(recipes).getByRole('button', { name: /Price-band trading/i }));
    fireEvent.click(screen.getByRole('button', { name: /Set price to spot/i }));
    expect(screen.getByLabelText('Starting reference price (USDC per WETH)')).toHaveValue('2600');
  });

  it('shows live spot and presets in the canvas condition inspector using originChain', async () => {
    setupDefaultRpcMocks();
    renderNewBuilder();

    const recipes = screen.getByRole('region', { name: 'Workflow recipes' });
    fireEvent.click(within(recipes).getByRole('button', { name: /Limit buy/i }));
    await waitFor(() => expect(screen.getByText('2,500.00')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Set price to -5% from spot/i }));
    fireEvent.change(screen.getByLabelText('USDC to spend'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Maximum slippage (%)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Expires at (Unix seconds)'), {
      target: { value: '2000000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open in builder' }));

    const canvas = screen.getByLabelText('Workflow diagram');
    fireEvent.click(within(canvas).getByTestId('rf__node-root'));

    const inspector = screen.getByRole('complementary', { name: 'Workflow inspector' });
    await waitFor(() =>
      expect(within(inspector).getByText('Spot · Unichain Sepolia')).toBeInTheDocument(),
    );
    expect(within(inspector).getByText('2,500.00')).toBeInTheDocument();
    expect(within(inspector).getByText('-5.0% vs spot')).toBeInTheDocument();

    fireEvent.click(
      within(inspector).getByRole('button', { name: /Set price to \+5% from spot/i }),
    );
    expect(within(inspector).getByLabelText('Price is at most threshold')).toHaveValue('2625');
    expect(within(inspector).getByText('+5.0% vs spot')).toBeInTheDocument();
  });
});
