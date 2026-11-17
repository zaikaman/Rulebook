import type { Proof as ProofData } from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Proof } from '../src/pages/Proof.js';
import { ApiError, api } from '../src/lib/api.js';

const HASH = `0x${'1'.repeat(64)}` as const;
const ORIGIN_HASH = `0x${'2'.repeat(64)}` as const;
const DESTINATION_HASH = `0x${'3'.repeat(64)}` as const;
const SELECTOR = '0x87b0b0ba';

const proof: ProofData = {
  reactive_tx: HASH,
  source: 'chain',
  cache_age_seconds: null,
  latency_ms: 840,
  rows: [
    {
      role: 'origin',
      chain_id: 1301,
      tx_hash: ORIGIN_HASH,
      block_number: 100,
      timestamp: '2026-11-16T10:00:00.000Z',
      explorer_url: `https://sepolia.uniscan.xyz/tx/${ORIGIN_HASH}`,
      error: null,
    },
    {
      role: 'automation',
      chain_id: 5_318_007,
      tx_hash: HASH,
      block_number: 200,
      timestamp: '2026-11-16T10:00:01.000Z',
      explorer_url: `https://reactscan.net/tx/${HASH}`,
      error: null,
    },
    {
      role: 'destination',
      chain_id: 1301,
      tx_hash: DESTINATION_HASH,
      block_number: 101,
      timestamp: '2026-11-16T10:00:02.000Z',
      explorer_url: `https://sepolia.uniscan.xyz/tx/${DESTINATION_HASH}`,
      error: null,
    },
  ],
};

function renderProof() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/proof/${HASH}`]}>
        <Routes>
          <Route path="/proof/:reactiveTxHash" element={<Proof />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('proof page', () => {
  it('renders three rows with roles, block times, explorer links, and one latency', async () => {
    vi.spyOn(api, 'proof').mockResolvedValue(proof);
    renderProof();

    const rows = await screen.findAllByTestId('proof-row');
    expect(rows.map((row) => row.dataset.role)).toEqual(['origin', 'automation', 'destination']);
    expect(screen.getByText('Origin event')).toBeInTheDocument();
    expect(screen.getByText('Block 100')).toBeInTheDocument();
    expect(screen.getByText('2026-11-16 10:00:00 UTC')).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', proof.rows[0]?.explorer_url);
    expect(links[1]).toHaveAttribute('href', proof.rows[1]?.explorer_url);
    expect(links[2]).toHaveAttribute('href', proof.rows[2]?.explorer_url);

    expect(screen.getAllByTestId('proof-latency')).toHaveLength(1);
    expect(screen.getByTestId('proof-latency')).toHaveTextContent('840 ms');
    expect(screen.getByTestId('proof-source')).toHaveTextContent('Live from chain');
  });

  it('shows a refused execution with its selector and no success state', async () => {
    vi.spyOn(api, 'proof').mockResolvedValue({
      ...proof,
      latency_ms: null,
      rows: [
        ...proof.rows.slice(0, 2),
        {
          ...proof.rows[2]!,
          error: {
            selector: SELECTOR,
            message: `${SELECTOR}${'0'.repeat(56)}`,
            human: 'The rule condition no longer holds, so nothing was executed.',
          },
        },
      ],
    });
    renderProof();

    await screen.findByTestId('proof-error-selector');
    expect(screen.getByTestId('proof-error-selector')).toHaveTextContent(SELECTOR);
    expect(
      screen.getByText('The rule condition no longer holds, so nothing was executed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/success/i)).not.toBeInTheDocument();
  });

  it('labels a cached proof with its age and never presents it as live', async () => {
    vi.spyOn(api, 'proof').mockResolvedValue({
      ...proof,
      source: 'cache',
      cache_age_seconds: 120,
      latency_ms: null,
    });
    renderProof();

    const source = await screen.findByTestId('proof-source');
    expect(source).toHaveTextContent('Cached proof · 120s old');
    expect(source).toHaveAttribute('data-source', 'cache');
    expect(screen.queryByTestId('proof-latency')).not.toBeInTheDocument();
  });

  it('explains that a 404 means the validators have not written the record yet', async () => {
    vi.spyOn(api, 'proof').mockRejectedValue(
      new ApiError('not_found', 'No callback recorded yet', null, 404),
    );
    renderProof();

    expect(await screen.findByText('No proof recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/validators have not written a callback record/i)).toBeInTheDocument();
  });
});
