import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const demoOwner = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const userOwner = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

const { mockUseAccount, mockDemoAccount } = vi.hoisted(() => ({
  mockUseAccount: vi.fn<() => { address?: string }>(() => ({ address: undefined })),
  mockDemoAccount: vi.fn(),
}));

vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wagmi')>();
  return {
    ...actual,
    useAccount: () => mockUseAccount(),
  };
});

vi.mock('../src/lib/contracts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/contracts.js')>();
  return {
    ...actual,
    resolveWorkflowV2Deployment: (mode: 'testnet' | 'mainnet') =>
      mode === 'testnet'
        ? {
            mode: 'testnet',
            automationChainId: 5318007,
            automationFactory: '0x1111111111111111111111111111111111111111',
            unichain: {
              chainId: 1301,
              factory: '0x2222222222222222222222222222222222222222',
              startBlock: 1,
            },
          }
        : undefined,
  };
});

vi.mock('../src/lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      demoAccount: (...args: unknown[]) => mockDemoAccount(...args),
    },
  };
});

import {
  DEMO_MODE_STORAGE_KEY,
  DemoModeProvider,
  DemoModeQuerySync,
  useDemoMode,
} from '../src/lib/demoMode.js';
import { NetworkModeProvider, useNetworkMode } from '../src/lib/networkMode.js';

function Harness() {
  const demo = useDemoMode();
  const network = useNetworkMode();
  const location = useLocation();
  return (
    <div>
      <span data-testid="is-demo">{String(demo.isDemoMode)}</span>
      <span data-testid="demo-available">{String(demo.demoAvailable)}</span>
      <span data-testid="view-owner">{demo.viewOwner ?? 'none'}</span>
      <span data-testid="mode">{network.mode}</span>
      <span data-testid="search">{location.search}</span>
      <button type="button" onClick={demo.enterDemoMode}>
        Enter demo
      </button>
      <button type="button" onClick={demo.exitDemoMode}>
        Exit demo
      </button>
      <button type="button" onClick={() => network.setMode('mainnet')}>
        Switch mainnet
      </button>
    </div>
  );
}

function renderDemo(initialEntry = '/workflows') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const makeTree = () => (
    <QueryClientProvider client={queryClient}>
      <NetworkModeProvider>
        <DemoModeProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <DemoModeQuerySync />
            <Routes>
              <Route path="*" element={<Harness />} />
            </Routes>
          </MemoryRouter>
        </DemoModeProvider>
      </NetworkModeProvider>
    </QueryClientProvider>
  );
  return { ...render(makeTree()), makeTree };
}

describe('DemoModeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockUseAccount.mockReturnValue({ address: undefined });
    mockDemoAccount.mockResolvedValue({
      available: true,
      owner: demoOwner,
      network: 'testnet',
      featuredRuns: [],
    });
  });

  it('enters and exits demo mode and switches mainnet back to testnet when entering', async () => {
    const user = userEvent.setup();
    renderDemo('/workflows');

    await waitFor(() => expect(screen.getByTestId('demo-available')).toHaveTextContent('true'));
    expect(screen.getByTestId('is-demo')).toHaveTextContent('false');
    expect(screen.getByTestId('view-owner')).toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'Switch mainnet' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('mainnet');

    await user.click(screen.getByRole('button', { name: 'Enter demo' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('testnet');
    expect(screen.getByTestId('is-demo')).toHaveTextContent('true');
    expect(screen.getByTestId('view-owner')).toHaveTextContent(demoOwner);
    expect(window.sessionStorage.getItem(DEMO_MODE_STORAGE_KEY)).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Switch mainnet' }));
    expect(screen.getByTestId('is-demo')).toHaveTextContent('false');

    await user.click(screen.getByRole('button', { name: 'Exit demo' }));
    expect(window.sessionStorage.getItem(DEMO_MODE_STORAGE_KEY)).toBeNull();
  });

  it('syncs ?demo=1 and ?demo=0 query parameters and auto-exits when a wallet connects', async () => {
    const { rerender, makeTree } = renderDemo('/workflows?demo=1');

    await waitFor(() => expect(screen.getByTestId('is-demo')).toHaveTextContent('true'));
    expect(screen.getByTestId('view-owner')).toHaveTextContent(demoOwner);
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));

    mockUseAccount.mockReturnValue({ address: userOwner });
    rerender(makeTree());

    await waitFor(() => expect(screen.getByTestId('is-demo')).toHaveTextContent('false'));
    expect(screen.getByTestId('view-owner')).toHaveTextContent(userOwner);
    expect(window.sessionStorage.getItem(DEMO_MODE_STORAGE_KEY)).toBeNull();
  });

  it('clears persisted demo mode when ?demo=0 is visited', async () => {
    window.sessionStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    renderDemo('/workflows?demo=0');

    await waitFor(() => expect(screen.getByTestId('demo-available')).toHaveTextContent('true'));
    expect(screen.getByTestId('is-demo')).toHaveTextContent('false');
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
    expect(window.sessionStorage.getItem(DEMO_MODE_STORAGE_KEY)).toBeNull();
  });
});
