import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { LatencyBar, RunProofPanel } from '../src/ui/index.js';

describe('Workflow proof UI primitives', () => {
  it('renders LatencyBar hop breakdown, total pill, and optional caption', () => {
    render(
      <LatencyBar
        title="Cross-chain timing"
        totalLabel="Total: 3s"
        totalTone="active"
        hops={[
          {
            id: 'origin-decision',
            label: 'Origin -> Lasna',
            value: '+1s',
            role: 'automation',
            share: 1 / 3,
          },
          {
            id: 'decision-settlement',
            label: 'Lasna -> Settlement',
            value: '+2s',
            role: 'funds',
            share: 2 / 3,
          },
        ]}
      />,
    );

    const region = screen.getByRole('region', { name: 'Cross-chain timing' });
    expect(region).toHaveTextContent('Total: 3s');
    expect(region).toHaveTextContent('Origin -> Lasna');
    expect(region).toHaveTextContent('+1s');
    expect(region).toHaveTextContent('Lasna -> Settlement');
    expect(region).toHaveTextContent('+2s');
  });

  it('renders RunProofPanel items, loading state, empty state, and error retry', () => {
    const runId = `0x${'1'.repeat(64)}` as const;
    const onRetry = vi.fn();

    const { rerender } = render(
      <MemoryRouter>
        <RunProofPanel
          title="Recent verified runs"
          description="One-tap proof links."
          badgeLabel="No wallet required"
          items={[
            {
              id: runId,
              to: `/runs/${runId}`,
              originChain: UNICHAIN_SEPOLIA_CHAIN_ID,
              automationChain: LASNA_CHAIN_ID,
              settlementChain: UNICHAIN_SEPOLIA_CHAIN_ID,
              path: 1,
              status: 'confirmed',
              latencyLabel: '3s',
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Recent verified runs' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Inspect proof/i });
    expect(link).toHaveAttribute('href', `/runs/${runId}`);
    expect(link).toHaveTextContent('3s');
    expect(link).toHaveTextContent('Path 2');

    rerender(
      <MemoryRouter>
        <RunProofPanel
          title="Recent verified runs"
          description="One-tap proof links."
          items={[]}
          loading
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Loading recent verified runs…')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <RunProofPanel
          title="Recent verified runs"
          description="One-tap proof links."
          items={[]}
          emptyMessage="No runs indexed yet."
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('No runs indexed yet.')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <RunProofPanel
          title="Recent verified runs"
          description="One-tap proof links."
          items={[]}
          error="Could not load recent runs."
          onRetry={onRetry}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load recent runs.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
