import { UNICHAIN_MAINNET_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseNetworkMode, mockConfiguredFundsChains } = vi.hoisted(() => ({
  mockUseNetworkMode: vi.fn(),
  mockConfiguredFundsChains: vi.fn((mode: 'testnet' | 'mainnet' = 'testnet') =>
    mode === 'mainnet' ? [130] : [1301],
  ),
}));

vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wagmi')>();
  return {
    ...actual,
    useAccount: () => ({ address: undefined }),
  };
});

vi.mock('../src/lib/networkMode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/networkMode.js')>();
  return {
    ...actual,
    useNetworkMode: () => mockUseNetworkMode(),
  };
});

vi.mock('../src/assistant/AssistantContext.js', () => ({
  useAssistant: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock('../src/components/chrome/WalletControl.js', () => ({
  WalletControl: () => <button type="button">Connect wallet</button>,
}));

vi.mock('../src/workflows/chainV2.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workflows/chainV2.js')>();
  return {
    ...actual,
    configuredFundsChains: (...args: Parameters<typeof actual.configuredFundsChains>) =>
      mockConfiguredFundsChains(...args),
    useWorkflowV2Wallet: () => ({ busy: false }),
  };
});

vi.mock('../src/workflows/WorkflowFunding.js', () => ({
  useWorkflowFunding: () => ({}),
  WorkflowFundingNotice: () => null,
}));

import { AppTopbar } from '../src/components/chrome/AppTopbar.js';
import { NewWorkflowLink } from '../src/components/chrome/NewWorkflowLink.js';
import { buildNetworkModeState } from '../src/lib/networkMode.js';
import { WorkflowBuilderV2 } from '../src/workflows/BuilderV2.js';

describe('Mainnet navigation query preservation & single-chain recipe picker', () => {
  beforeEach(() => {
    mockUseNetworkMode.mockReset();
    mockConfiguredFundsChains.mockReset();
    mockConfiguredFundsChains.mockImplementation((mode: 'testnet' | 'mainnet' = 'testnet') =>
      mode === 'mainnet' ? [UNICHAIN_MAINNET_CHAIN_ID] : [UNICHAIN_SEPOLIA_CHAIN_ID],
    );
  });

  it('preserves ?network=mainnet on AppTopbar breadcrumb and NewWorkflowLink, and omits it on Testnet', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      configuredFundsChains: [UNICHAIN_MAINNET_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/activity?network=mainnet']}>
        <AppTopbar />
        <NewWorkflowLink />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
      'href',
      '/workflows?network=mainnet',
    );
    expect(screen.getByRole('link', { name: 'New workflow' })).toHaveAttribute(
      'href',
      '/workflows/new?network=mainnet',
    );

    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      configuredFundsChains: [UNICHAIN_SEPOLIA_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });

    rerender(
      <MemoryRouter initialEntries={['/activity']}>
        <AppTopbar />
        <NewWorkflowLink />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/workflows');
    expect(screen.getByRole('link', { name: 'New workflow' })).toHaveAttribute(
      'href',
      '/workflows/new',
    );
  });

  it('displays Unichain (never Unichain Sepolia) on recipe cards when Mainnet has only one configured funds chain', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      configuredFundsChains: [UNICHAIN_MAINNET_CHAIN_ID],
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });
    mockConfiguredFundsChains.mockReturnValue([UNICHAIN_MAINNET_CHAIN_ID]);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/workflows/new?network=mainnet']}>
          <Routes>
            <Route path="/workflows/new" element={<WorkflowBuilderV2 />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const metaLabels = Array.from(container.querySelectorAll('.rb-recipe-meta')).map(
      (node) => node.textContent,
    );
    expect(metaLabels.length).toBeGreaterThan(0);
    for (const label of metaLabels) {
      expect(label).toBe('Unichain');
    }
    expect(container.textContent).not.toContain('Unichain Sepolia');
  });
});
