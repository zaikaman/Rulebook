import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { PageHeading } from '../components/chrome/PageHeading.js';
import { ChainOnlyProof } from '../components/ChainOnlyProof.js';
import { ErrorState } from '../components/ErrorState.js';
import { ProofRow } from '../components/ProofRow.js';
import { useProof, proofErrorCopy } from '../hooks/useProof.js';

const CHAIN_ONLY_PROOF_ENABLED = import.meta.env.VITE_ENABLE_CHAIN_ONLY_PROOF === 'true';

function latencyLabel(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(1)} s`;
}

/** `/proof/:reactiveTxHash`: three chain-backed rows, one latency figure, an honest source. */
export function Proof() {
  const { reactiveTxHash } = useParams();
  const navigate = useNavigate();
  const [lookup, setLookup] = useState('');
  const [copied, setCopied] = useState(false);
  const proofQuery = useProof(reactiveTxHash);

  async function copyHash(hash: string): Promise<void> {
    await navigator.clipboard?.writeText(hash);
    setCopied(true);
  }

  if (!reactiveTxHash) {
    return (
      <section className="space-y-5">
        <PageHeading
          title="Execution proof"
          description="Open a proof by the Lasna transaction that evaluated the rule."
        />
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = lookup.trim().toLowerCase();
            if (/^0x[0-9a-f]{64}$/.test(value)) navigate(`/proof/${value}`);
          }}
        >
          <label className="sr-only" htmlFor="proof-hash">
            Reactive transaction hash
          </label>
          <input
            id="proof-hash"
            value={lookup}
            onChange={(event) => setLookup(event.target.value)}
            placeholder="0x…"
            className="min-w-72 flex-1 rounded border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-ink"
          />
          <button
            type="submit"
            className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface"
          >
            Open proof
          </button>
        </form>
      </section>
    );
  }

  if (proofQuery.isLoading) {
    return (
      <section aria-busy="true" className="space-y-4">
        <PageHeading title="Execution proof" description="Reading the chain…" />
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-lg border border-border bg-surface-raised"
          />
        ))}
      </section>
    );
  }

  if (proofQuery.error || !proofQuery.data) {
    const copy = proofErrorCopy(proofQuery.error);
    return (
      <section className="space-y-4">
        <PageHeading title="Execution proof" description="No proof is being invented." />
        <ErrorState message={copy.title} detail={copy.detail} />
        {CHAIN_ONLY_PROOF_ENABLED ? <ChainOnlyProof reactiveTxHash={reactiveTxHash} /> : null}
      </section>
    );
  }

  const proof = proofQuery.data;

  return (
    <section className="space-y-5">
      <PageHeading
        title="Execution proof"
        description="Origin event → automation transaction → destination transaction. Each row opens on its own explorer."
      />

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="proof-source"
            data-source={proof.source}
            className={
              proof.source === 'chain'
                ? 'rounded-full border border-active/40 bg-active/10 px-2 py-0.5 text-xs text-active'
                : 'rounded-full border border-paused/40 bg-paused/10 px-2 py-0.5 text-xs text-paused'
            }
          >
            {proof.source === 'chain'
              ? 'Live from chain'
              : `Cached proof · ${proof.cache_age_seconds ?? 0}s old`}
          </span>
          {proof.latency_ms !== null && proof.latency_ms !== undefined ? (
            <span data-testid="proof-latency" className="font-mono text-sm font-semibold text-ink">
              {latencyLabel(proof.latency_ms)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <code className="break-all font-mono text-xs text-ink-muted">{proof.reactive_tx}</code>
          <button
            type="button"
            onClick={() => void copyHash(proof.reactive_tx)}
            className="rounded-full border border-border px-3 py-1 text-xs text-ink"
          >
            {copied ? 'Copied' : 'Copy hash'}
          </button>
        </div>
      </div>

      <ol aria-label="Proof rows" className="space-y-3">
        {proof.rows.map((row) => (
          <ProofRow key={`${row.role}-${row.tx_hash}`} row={row} />
        ))}
      </ol>

      <p className="text-xs text-ink-muted">
        This view is built from Lasna <code className="font-mono">getCallbacks</code> and the two
        public RPCs. Our database is a cache, never the authority.
      </p>

      {CHAIN_ONLY_PROOF_ENABLED ? <ChainOnlyProof reactiveTxHash={proof.reactive_tx} /> : null}
    </section>
  );
}
