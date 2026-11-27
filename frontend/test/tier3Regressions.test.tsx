import {
  BASE_SEPOLIA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  emptyDraft,
  type V2Draft,
} from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zeroAddress } from 'viem';

const OWNER_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const OWNER_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const WORKFLOW_ID = `0x${'11'.repeat(32)}`;

const { mockAccount, mockSignMessageAsync, mockUseNetworkMode, mockStreamAssistant, mockApi } =
  vi.hoisted(() => ({
    mockAccount: vi.fn<() => { address?: `0x${string}`; connector?: object }>(() => ({
      address: OWNER_A,
      connector: { id: 'mock', name: 'MockWallet' },
    })),
    mockSignMessageAsync: vi.fn(async () => `0x${'ab'.repeat(65)}` as const),
    mockUseNetworkMode: vi.fn(),
    mockStreamAssistant: vi.fn(),
    mockApi: {
      rulewrightAvailability: vi.fn(async () => ({ available: true })),
      rulewrightEnqueue: vi.fn(async () => ({ id: 'job-1' })),
      rulewrightJob: vi.fn(),
      assistantAvailability: vi.fn(async () => ({ available: true })),
      assistantChallenge: vi.fn(),
      assistantSession: vi.fn(),
    },
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

vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wagmi')>();
  return {
    ...actual,
    useAccount: () => mockAccount(),
    useSignMessage: () => ({ signMessageAsync: mockSignMessageAsync }),
  };
});

vi.mock('../src/lib/networkMode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/networkMode.js')>();
  return {
    ...actual,
    useNetworkMode: () => mockUseNetworkMode(),
  };
});

vi.mock('../src/lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      ...mockApi,
    },
  };
});

vi.mock('../src/lib/assistant.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/assistant.js')>();
  return {
    ...actual,
    streamAssistant: (...args: Parameters<typeof actual.streamAssistant>) =>
      mockStreamAssistant(...args),
  };
});

import { NetworkModeQuerySync } from '../src/app/router.js';
import { AssistantPanel } from '../src/assistant/AssistantPanel.js';
import { SignatureSummary } from '../src/components/SignatureSummary.js';
import { buildNetworkModeState } from '../src/lib/networkMode.js';
import { Dialog } from '../src/ui/Dialog.js';
import { RulewrightDialog, type RulewrightSession } from '../src/workflows/RulewrightDialog.js';

function LocationSpy() {
  const { search } = useLocation();
  return <span data-testid="location-search">{search}</span>;
}

describe('Tier 3 frontend regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccount.mockReturnValue({
      address: OWNER_A,
      connector: { id: 'mock', name: 'MockWallet' },
    });
    mockUseNetworkMode.mockReturnValue({
      ...buildNetworkModeState('testnet'),
      isDeploymentConfigured: true,
      setMode: vi.fn(),
    });
  });

  it('forwards data-network-mode to the underlying <dialog> element', () => {
    render(
      <Dialog labelledBy="dialog-title" data-network-mode="mainnet">
        <h2 id="dialog-title">Mainnet body</h2>
      </Dialog>,
    );
    const dialog = document.querySelector('dialog');
    expect(dialog).toHaveAttribute('data-network-mode', 'mainnet');
  });

  it('avoids doubled Mainnet labels and distinguishes off-chain signatures in SignatureSummary', () => {
    const { rerender } = render(
      <SignatureSummary
        details={{
          chainId: REACTIVE_MAINNET_CHAIN_ID,
          target: zeroAddress,
          targetLabel: 'Contract address',
          effect: 'Enable workflow on Reactive Mainnet.',
          amount: 'Network fees only',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/You are signing on Reactive Mainnet\./)).toBeInTheDocument();
    expect(screen.queryByText(/Mainnet Mainnet/)).not.toBeInTheDocument();
    expect(screen.getByText('Mainnet signature · Real funds')).toBeInTheDocument();

    rerender(
      <SignatureSummary
        details={{
          chainId: REACTIVE_MAINNET_CHAIN_ID,
          target: zeroAddress,
          targetLabel: 'Automation Agent',
          effect: 'Sign in to Telegram notifications.',
          amount: 'Off-chain message (no gas)',
          offChain: true,
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Mainnet signature · Off-chain')).toBeInTheDocument();
    expect(screen.queryByText(/Real funds/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to wallet' })).toBeInTheDocument();
  });

  it('syncs ?network= in the URL when toggling network mode even if the initial URL omitted ?network=', async () => {
    let currentMode: 'testnet' | 'mainnet' = 'testnet';
    const syncSetter = vi.fn((next: 'testnet' | 'mainnet') => {
      currentMode = next;
    });

    mockUseNetworkMode.mockImplementation(() => ({
      ...buildNetworkModeState(currentMode),
      setMode: syncSetter,
    }));

    const { rerender } = render(
      <MemoryRouter initialEntries={['/workflows']}>
        <NetworkModeQuerySync />
        <LocationSpy />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('location-search')).toHaveTextContent('');
    currentMode = 'mainnet';
    rerender(
      <MemoryRouter initialEntries={['/workflows']}>
        <NetworkModeQuerySync />
        <LocationSpy />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?network=mainnet');
    });

    currentMode = 'testnet';
    rerender(
      <MemoryRouter initialEntries={['/workflows']}>
        <NetworkModeQuerySync />
        <LocationSpy />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('');
    });
  });

  it('diffs weekly budgets and locks settlement chain during existing-workflow Rulewright edits', async () => {
    const baseline: V2Draft = {
      ...emptyDraft(UNICHAIN_SEPOLIA_CHAIN_ID),
      title: 'Scheduled buy',
      usdcCap: '10',
    };
    const returnedDraft: V2Draft = {
      ...baseline,
      chain: BASE_SEPOLIA_CHAIN_ID,
      originChain: BASE_SEPOLIA_CHAIN_ID,
      usdcWeeklyBudget: '50',
    };
    mockApi.rulewrightJob.mockResolvedValue({
      status: 'complete',
      result: { type: 'draft', draft: returnedDraft },
    });
    const apply = vi.fn();

    function Wrapper() {
      const session = useRef<RulewrightSession | undefined>({
        owner: OWNER_A,
        network: 'testnet',
        token: 'rw-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
      return (
        <RulewrightDialog
          draft={baseline}
          lockChain
          session={session}
          close={vi.fn()}
          apply={apply}
          summary={() => <p>Summary</p>}
        />
      );
    }

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Wrapper />
      </QueryClientProvider>,
    );

    const textarea = await screen.findByLabelText(/Workflow description/);
    fireEvent.change(textarea, { target: { value: 'Set a 50 USDC weekly budget.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));

    await expect(screen.findByText('Weekly USDC budget')).resolves.toBeInTheDocument();
    expect(screen.getByText('50 USDC')).toBeInTheDocument();
    const applyButton = screen.getByRole('button', { name: 'Apply to canvas' });
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        originChain: UNICHAIN_SEPOLIA_CHAIN_ID,
        usdcWeeklyBudget: '50',
      }),
    );
  });

  it('shows generic prompts on /workflows/new, workflow prompts on /workflows/:id, and aborts stream on wallet switch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <AssistantPanel open page={{ path: '/workflows/new' }} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('When did it last run?')).not.toBeInTheDocument();

    mockApi.assistantChallenge.mockResolvedValue({
      nonce: `0x${'ab'.repeat(32)}`,
      origin: window.location.origin,
      owner: OWNER_A.toLowerCase(),
      network: 'testnet',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    mockApi.assistantSession.mockResolvedValue({
      token: 'a'.repeat(43),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    let streamSignal: AbortSignal | undefined;
    mockStreamAssistant.mockImplementation(
      async (_input: unknown, _token: string, _onEvent: unknown, signal: AbortSignal) => {
        streamSignal = signal;
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    );

    rerender(
      <QueryClientProvider client={client}>
        <AssistantPanel open page={{ path: `/workflows/${WORKFLOW_ID}` }} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Verify wallet/i }));
    const promptBtn = await screen.findByRole('button', { name: 'When did it last run?' });
    await act(async () => {
      fireEvent.click(promptBtn);
    });
    await waitFor(() => {
      expect(streamSignal).toBeDefined();
    });
    expect(streamSignal?.aborted).toBe(false);

    mockAccount.mockReturnValue({
      address: OWNER_B,
      connector: { id: 'mock', name: 'MockWallet' },
    });
    rerender(
      <QueryClientProvider client={client}>
        <AssistantPanel open page={{ path: `/workflows/${WORKFLOW_ID}` }} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(streamSignal?.aborted).toBe(true);
    });
    expect(screen.queryByText('When did it last run?')).not.toBeInTheDocument();
  });
});
