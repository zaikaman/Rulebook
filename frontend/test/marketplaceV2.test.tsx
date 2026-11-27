import {
  BASE_SEPOLIA_CHAIN_ID,
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowV2Action,
  workflowV2Nodes,
  workflowV2Trigger,
  workflowV2Unit,
} from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keccak256, zeroAddress } from 'viem';

const { mockUseNetworkMode, mockWorkflowV2DeploymentFor, mockWorkflowClient } = vi.hoisted(() => ({
  mockUseNetworkMode: vi.fn(),
  mockWorkflowV2DeploymentFor: vi.fn(),
  mockWorkflowClient: vi.fn(),
}));

if (typeof AbortSignal.any !== 'function') {
  AbortSignal.any = (signals: Iterable<AbortSignal>) => {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  };
}

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
    workflowV2DeploymentFor: (...args: Parameters<typeof actual.workflowV2DeploymentFor>) =>
      mockWorkflowV2DeploymentFor(...args),
    workflowClient: (...args: Parameters<typeof actual.workflowClient>) =>
      mockWorkflowClient(...args),
  };
});

import { buildNetworkModeState } from '../src/lib/networkMode.js';
import { WorkflowListingV2, WorkflowMarketplaceV2 } from '../src/workflows/MarketplaceV2.js';

const OWNER_1 = '0x1111111111111111111111111111111111111111' as const;
const OWNER_2 = '0x2222222222222222222222222222222222222222' as const;
const AGENT_1 = '0xaaaa111111111111111111111111111111111111' as const;
const AGENT_2 = '0xbbbb222222222222222222222222222222222222' as const;
const WF_1 = `0x${'a'.repeat(64)}` as const;
const WF_2 = `0x${'b'.repeat(64)}` as const;

const programSchedule = encodeWorkflowV2(
  createWorkflowV2Recipe('recurring-transfer', {
    intervalSeconds: '3600',
    sendUsdc: '5',
    recipient: OWNER_2,
  }),
);
const programCrossPrice = encodeWorkflowV2({
  chain: BASE_SEPOLIA_CHAIN_ID,
  originChain: UNICHAIN_SEPOLIA_CHAIN_ID,
  trigger: workflowV2Trigger.price,
  interval: 0,
  expires: 0n,
  source: zeroAddress,
  subject: zeroAddress,
  usdcCap: 10_000_000n,
  wethCap: 0n,
  slippage: 100,
  once: false,
  nodes: workflowV2Nodes({
    actions: [
      {
        kind: workflowV2Action.buy,
        unit: workflowV2Unit.fixed,
        amount: 5_000_000n,
        account: zeroAddress,
      },
    ],
  }),
});

const listingsFixture = [
  {
    id: '1',
    title: 'Weekly USDC DCA',
    description: 'Automates scheduled treasury payouts every hour.',
    owner: OWNER_1,
    agent: AGENT_1,
    workflow_id: WF_1,
    program_hash: keccak256(programSchedule),
    chain: UNICHAIN_SEPOLIA_CHAIN_ID,
    origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
    trigger: 1 as const,
    program: programSchedule,
    verified_runs: 12,
  },
  {
    id: '2',
    title: 'Cross-chain price dip',
    description: 'Monitors Unichain Sepolia pool price and settles on Base Sepolia.',
    owner: OWNER_2,
    agent: AGENT_2,
    workflow_id: WF_2,
    program_hash: keccak256(programCrossPrice),
    chain: BASE_SEPOLIA_CHAIN_ID,
    origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
    trigger: 3 as const,
    program: programCrossPrice,
    verified_runs: 0,
  },
];

function renderWithQuery(ui: React.ReactNode, initialEntry = '/marketplace') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/marketplace" element={ui} />
          <Route path="/marketplace/:listingId" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkflowMarketplaceV2', () => {
  beforeEach(() => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders verified run badges, cross-chain badges, filter chips, search, and resets cleanly', async () => {
    const requestedUrls: URL[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const chain = url.searchParams.get('chain');
      const crossChain = url.searchParams.get('crossChain');
      const trigger = url.searchParams.get('trigger');
      const triggerMap: Record<string, number> = {
        schedule: 1,
        payment: 2,
        price: 3,
        transfer: 4,
      };
      const filtered = listingsFixture.filter((item) => {
        if (
          q &&
          !item.title.toLowerCase().includes(q) &&
          !item.description.toLowerCase().includes(q)
        ) {
          return false;
        }
        if (chain && String(item.chain) !== chain) return false;
        if (crossChain === 'true' && item.origin_chain === item.chain) return false;
        if (crossChain === 'false' && item.origin_chain !== item.chain) return false;
        if (trigger && item.trigger !== triggerMap[trigger]) return false;
        return true;
      });
      return new Response(JSON.stringify({ listings: filtered, nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    renderWithQuery(<WorkflowMarketplaceV2 />);

    await waitFor(() => {
      expect(screen.getByText('Weekly USDC DCA')).toBeInTheDocument();
    });
    expect(screen.getByText('Cross-chain price dip')).toBeInTheDocument();

    const verifiedBadge = screen.getByText('12 verified runs').closest('.rb-chip');
    expect(verifiedBadge).toHaveAttribute('data-tone', 'active');
    const zeroBadge = screen.getByText('0 verified runs').closest('.rb-chip');
    expect(zeroBadge).not.toHaveAttribute('data-tone', 'active');
    const crossChainCard = screen.getByRole('link', { name: /Cross-chain price dip/ });
    expect(within(crossChainCard).getByText('Cross-chain', { exact: true })).toBeInTheDocument();

    // Filter by cross-chain routing chip.
    const routingGroup = screen.getByRole('group', { name: 'Routing' });
    fireEvent.click(within(routingGroup).getByRole('button', { name: 'Cross-chain' }));
    await waitFor(() => {
      expect(screen.queryByText('Weekly USDC DCA')).not.toBeInTheDocument();
      expect(screen.getByText('Cross-chain price dip')).toBeInTheDocument();
    });

    // Combine with Base Sepolia network chip and Pool price trigger chip.
    const networkGroup = screen.getByRole('group', { name: 'Network' });
    fireEvent.click(within(networkGroup).getByRole('button', { name: 'Base Sepolia' }));
    const triggerGroup = screen.getByRole('group', { name: 'Trigger' });
    fireEvent.click(within(triggerGroup).getByRole('button', { name: 'Pool price' }));

    await waitFor(() => {
      const lastUrl = requestedUrls.at(-1);
      expect(lastUrl?.searchParams.get('chain')).toBe(String(BASE_SEPOLIA_CHAIN_ID));
      expect(lastUrl?.searchParams.get('crossChain')).toBe('true');
      expect(lastUrl?.searchParams.get('trigger')).toBe('price');
    });

    // Search matching description only returns the matching listing, or triggers empty state if incompatible.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const searchInput = screen.getByRole('searchbox', { name: 'Search listings' });
    fireEvent.change(searchInput, { target: { value: 'treasury' } });
    await act(async () => {
      vi.advanceTimersByTime(220);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByText('No listings match your filters')).toBeInTheDocument();
    });

    // Reset filters restores all listings.
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0]!);
    await waitFor(() => {
      expect(screen.getByText('Weekly USDC DCA')).toBeInTheDocument();
      expect(screen.getByText('Cross-chain price dip')).toBeInTheDocument();
    });
  });

  it('drops an incompatible chain filter when switching between testnet and mainnet', async () => {
    const requestedUrls: URL[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requestedUrls.push(new URL(String(input)));
      return new Response(JSON.stringify({ listings: [], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const { rerender } = renderWithQuery(<WorkflowMarketplaceV2 />);
    await waitFor(() => {
      expect(requestedUrls.length).toBeGreaterThanOrEqual(1);
    });

    const networkGroup = screen.getByRole('group', { name: 'Network' });
    fireEvent.click(within(networkGroup).getByRole('button', { name: 'Base Sepolia' }));
    await waitFor(() => {
      expect(requestedUrls.at(-1)?.searchParams.get('chain')).toBe(String(BASE_SEPOLIA_CHAIN_ID));
    });

    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/marketplace?network=mainnet']}>
          <Routes>
            <Route path="/marketplace" element={<WorkflowMarketplaceV2 />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const mainnetCalls = requestedUrls.filter((u) => u.searchParams.get('network') === 'mainnet');
      expect(mainnetCalls.length).toBeGreaterThan(0);
      expect(mainnetCalls.at(-1)?.searchParams.get('chain')).toBeNull();
    });
    const updatedNetworkGroup = screen.getByRole('group', { name: 'Network' });
    expect(
      within(updatedNetworkGroup).getByRole('button', { name: 'Unichain' }),
    ).toBeInTheDocument();
    expect(
      within(updatedNetworkGroup).queryByRole('button', { name: 'Base Sepolia' }),
    ).not.toBeInTheDocument();
    expect(UNICHAIN_MAINNET_CHAIN_ID).toBe(130);
  });

  it('shows verified runs, trigger, and cross-chain origin details on WorkflowListingV2', async () => {
    const item = listingsFixture[1]!;
    mockWorkflowV2DeploymentFor.mockReturnValue({
      automationFactory: AGENT_1,
      vaults: { [BASE_SEPOLIA_CHAIN_ID]: AGENT_2 },
    });
    mockWorkflowClient.mockReturnValue({
      call: async () => {
        const { encodeAbiParameters } = await import('viem');
        const data = encodeAbiParameters(
          [
            { type: 'address' },
            { type: 'address' },
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'bool' },
          ],
          [item.owner, item.agent, item.workflow_id, item.program_hash, true],
        );
        return { data };
      },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ ...item, verified_runs: 7 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    renderWithQuery(<WorkflowListingV2 />, '/marketplace/2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: item.title })).toBeInTheDocument();
    });
    expect(screen.getByText('7 verified runs')).toBeInTheDocument();
    const facts = document.querySelector('.rb-listing-facts') as HTMLElement;
    expect(within(facts).getByText('Pool price changes')).toBeInTheDocument();
    expect(within(facts).getByText('Watches')).toBeInTheDocument();
    expect(within(facts).getByText('Cross-chain')).toBeInTheDocument();
  });

  it('handles singular verified run label, Load more pagination, and ErrorState hiding stale cards', async () => {
    let failNext = false;
    const singleRunItem = {
      ...listingsFixture[0]!,
      id: '10',
      title: 'Single proof workflow',
      verified_runs: 1,
    };
    const secondPageItem = {
      ...listingsFixture[1]!,
      id: '11',
      title: 'Second page workflow',
      verified_runs: 2,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (failNext) {
        return new Response(JSON.stringify({ message: 'down' }), { status: 500 });
      }
      const url = new URL(String(input));
      if (url.searchParams.get('after') === 'cursor-1') {
        return new Response(JSON.stringify({ listings: [secondPageItem], nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ listings: [singleRunItem], nextCursor: 'cursor-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    renderWithQuery(<WorkflowMarketplaceV2 />);

    await waitFor(() => {
      expect(screen.getByText('Single proof workflow')).toBeInTheDocument();
    });
    expect(screen.getByText('1 verified run')).toBeInTheDocument();
    expect(screen.getByText('1+ listed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more listings' }));
    await waitFor(() => {
      expect(screen.getByText('Second page workflow')).toBeInTheDocument();
    });
    expect(screen.getByText('2 listed')).toBeInTheDocument();

    // Triggering a failing filter shows ErrorState and hides the stale grid/pagination.
    failNext = true;
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Routing' })).getByRole('button', {
        name: 'Cross-chain',
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('The Marketplace could not load.');
    });
    expect(screen.queryByText('Single proof workflow')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more listings' })).not.toBeInTheDocument();
  });
});
