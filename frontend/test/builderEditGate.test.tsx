import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseNetworkMode = vi.fn();
const mockReadWorkflowV2 = vi.fn();
const mockReadWorkflowWeeklyBudget = vi.fn();

vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wagmi')>();
  return {
    ...actual,
    useAccount: () => ({ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const }),
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
    readWorkflowV2: (...args: Parameters<typeof actual.readWorkflowV2>) =>
      mockReadWorkflowV2(...args),
    readWorkflowWeeklyBudget: (...args: Parameters<typeof actual.readWorkflowWeeklyBudget>) =>
      mockReadWorkflowWeeklyBudget(...args),
  };
});

import { buildNetworkModeState } from '../src/lib/networkMode.js';
import { WorkflowBuilderV2 } from '../src/workflows/BuilderV2.js';

const WORKFLOW_ID = `0x${'11'.repeat(32)}`;

function renderEditRoute(path = `/workflows/${WORKFLOW_ID}/edit`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/workflows/:id/edit" element={<WorkflowBuilderV2 />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkflowBuilderV2 edit route deployment gating', () => {
  beforeEach(() => {
    mockReadWorkflowV2.mockReset();
    mockReadWorkflowWeeklyBudget.mockReset();
  });

  it('shows MainnetUnavailableCallout on /workflows/:id/edit when mainnet is unconfigured instead of reading chain state', () => {
    const setMode = vi.fn();
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      isDeploymentConfigured: false,
      setMode,
    });

    renderEditRoute();

    expect(screen.getByText('Mainnet contracts are not deployed yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Editing workflows requires deployed Mainnet Agent and Vault factories/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('This wallet has no workflow account.')).not.toBeInTheDocument();
    expect(mockReadWorkflowV2).not.toHaveBeenCalled();
    expect(mockReadWorkflowWeeklyBudget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Testnet' }));
    expect(setMode).toHaveBeenCalledWith('testnet');
  });

  it('shows an unconfigured Callout on testnet when deployment is missing', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      isDeploymentConfigured: false,
      setMode: vi.fn(),
    });

    renderEditRoute();

    expect(screen.getByText('Contracts are not configured for Reactive Lasna')).toBeInTheDocument();
    expect(mockReadWorkflowV2).not.toHaveBeenCalled();
  });

  it('still rejects invalid workflow IDs before gating on deployment', () => {
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('mainnet'),
      isDeploymentConfigured: false,
      setMode: vi.fn(),
    });

    renderEditRoute('/workflows/not-a-workflow-id/edit');

    expect(screen.getByRole('alert')).toHaveTextContent('This workflow link is invalid.');
    expect(mockReadWorkflowV2).not.toHaveBeenCalled();
  });
});
