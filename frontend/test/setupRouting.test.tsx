import { BASE_SEPOLIA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseAccount, mockUseNetworkMode, mockReadAgent, mockReadVault } = vi.hoisted(() => ({
  mockUseAccount: vi.fn(),
  mockUseNetworkMode: vi.fn(),
  mockReadAgent: vi.fn(),
  mockReadVault: vi.fn(),
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
    configuredFundsChains: () => [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
    readAgent: (...args: Parameters<typeof actual.readAgent>) => mockReadAgent(...args),
    readVault: (...args: Parameters<typeof actual.readVault>) => mockReadVault(...args),
    workflowClient: () => ({
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === 'vaults' ? VAULT : AGENT,
      ),
    }),
  };
});

import { buildNetworkModeState } from '../src/lib/networkMode.js';
import { safeNextPath, setupHref, stripNetworkQuery } from '../src/lib/routes.js';
import { RequireAccountSetup } from '../src/workflows/useLinkedAccount.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;

function SetupEcho() {
  const location = useLocation();
  return <div data-testid="setup-redirect">{`${location.pathname}${location.search}`}</div>;
}

describe('routes setup helpers', () => {
  it('strips only the network query parameter while preserving other params and hash', () => {
    expect(stripNetworkQuery('/workflows/new?review=1&network=mainnet#step')).toBe(
      '/workflows/new?review=1#step',
    );
    expect(stripNetworkQuery('/workflows?network=testnet')).toBe('/workflows');
  });

  it('validates next paths and blocks open redirects or self-redirect loops', () => {
    expect(safeNextPath('/workflows/new?review=1')).toBe('/workflows/new?review=1');
    expect(safeNextPath('/account?credit=execution')).toBe('/account?credit=execution');
    expect(safeNextPath('//evil.com')).toBe('/workflows');
    expect(safeNextPath('https://evil.com/workflows')).toBe('/workflows');
    expect(safeNextPath('/setup?next=/workflows')).toBe('/workflows');
    expect(safeNextPath('/SETUP?next=/workflows')).toBe('/workflows');
    expect(safeNextPath('/create')).toBe('/workflows');
    expect(safeNextPath('/Create?chain=1301')).toBe('/workflows');
    expect(safeNextPath(null)).toBe('/workflows');
  });

  it('builds /setup links without duplicating ?network= inside next', () => {
    expect(
      setupHref({
        next: '/workflows/new?review=1&network=mainnet',
        chain: BASE_SEPOLIA_CHAIN_ID,
        mode: 'mainnet',
      }),
    ).toBe('/setup?next=%2Fworkflows%2Fnew%3Freview%3D1&chain=84532&network=mainnet');

    expect(
      setupHref({
        next: '/setup',
        mode: 'testnet',
      }),
    ).toBe('/setup');
  });
});

describe('RequireAccountSetup', () => {
  beforeEach(() => {
    mockUseAccount.mockReset();
    mockUseNetworkMode.mockReset();
    mockReadAgent.mockReset();
    mockReadVault.mockReset();
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      isDeploymentConfigured: true,
      deployment: {
        automationFactory: '0x1111111111111111111111111111111111111111',
        unichain: { factory: '0x2222222222222222222222222222222222222222' },
      },
      setMode: vi.fn(),
    });
  });

  function renderGuard(initialEntry = '/workflows') {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              path="/workflows"
              element={
                <RequireAccountSetup title="Workflows">
                  {(linked) => (
                    <div data-testid="guarded-content">
                      {linked ? `linked:${linked.chain}` : 'disconnected'}
                    </div>
                  )}
                </RequireAccountSetup>
              }
            />
            <Route path="/setup" element={<SetupEcho />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('passes through when wallet is disconnected', () => {
    mockUseAccount.mockReturnValue({ address: undefined, isReconnecting: false });

    renderGuard();

    expect(screen.getByTestId('guarded-content')).toHaveTextContent('disconnected');
    expect(mockReadAgent).not.toHaveBeenCalled();
  });

  it('passes through when deployment is not configured', () => {
    mockUseAccount.mockReturnValue({ address: OWNER, isReconnecting: false });
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      isDeploymentConfigured: false,
      deployment: undefined,
      setMode: vi.fn(),
    });

    renderGuard('/workflows?network=mainnet');

    expect(screen.getByTestId('guarded-content')).toHaveTextContent('disconnected');
    expect(mockReadAgent).not.toHaveBeenCalled();
  });

  it('passes through with linked account when wallet has linked Agent and Vault', async () => {
    mockUseAccount.mockReturnValue({ address: OWNER, isReconnecting: false });
    mockReadAgent.mockResolvedValue(AGENT);
    mockReadVault.mockResolvedValue(VAULT);

    renderGuard();

    await waitFor(() =>
      expect(screen.getByTestId('guarded-content')).toHaveTextContent(
        `linked:${UNICHAIN_SEPOLIA_CHAIN_ID}`,
      ),
    );
  });

  it('redirects connected unsetup wallets to /setup with next and chain preserved', async () => {
    mockUseAccount.mockReturnValue({ address: OWNER, isReconnecting: false });
    mockReadAgent.mockResolvedValue('0x0000000000000000000000000000000000000000');

    renderGuard(`/workflows?chain=${BASE_SEPOLIA_CHAIN_ID}`);

    await waitFor(() =>
      expect(screen.getByTestId('setup-redirect')).toHaveTextContent(
        `/setup?next=%2Fworkflows%3Fchain%3D${BASE_SEPOLIA_CHAIN_ID}&chain=${BASE_SEPOLIA_CHAIN_ID}`,
      ),
    );
  });

  it('renders an error state with retry and recovery link if account lookup fails', async () => {
    mockUseAccount.mockReturnValue({ address: OWNER, isReconnecting: false });
    mockReadAgent.mockRejectedValue(new Error('RPC timeout'));

    renderGuard();

    await waitFor(() =>
      expect(screen.getByText('Your account status could not be loaded.')).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Manage existing vault funds' })).toHaveAttribute(
      'href',
      '/account/funds',
    );
  });
});
