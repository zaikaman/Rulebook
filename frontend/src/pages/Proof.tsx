import {
  Activity01Icon,
  ArrowRight02Icon,
  Copy01Icon,
  FlashIcon,
  Search01Icon,
  TransactionHistoryIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { PageHeading } from '../components/chrome/PageHeading.js';
import { ChainOnlyProof } from '../components/ChainOnlyProof.js';
import { ErrorState } from '../components/ErrorState.js';
import { HowItWorks } from '../components/chrome/HowItWorks.js';
import { ProofRow } from '../components/ProofRow.js';
import { useProof, proofErrorCopy } from '../hooks/useProof.js';
import { appRoutes } from '../lib/routes.js';

const CHAIN_ONLY_PROOF_ENABLED = import.meta.env.VITE_ENABLE_CHAIN_ONLY_PROOF === 'true';

function latencyLabel(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(1)} s`;
}

/** `/proof/:reactiveTxHash`: three chain-backed rows, one latency figure, an honest source. */
export function Proof() {
  const { reactiveTxHash } = useParams();
  const navigate = useNavigate();
  const [lookup, setLookup] = useState('');
  const [lookupInvalid, setLookupInvalid] = useState(false);
  const [copyResult, setCopyResult] = useState<{ hash: string; ok: boolean }>();
  const proofQuery = useProof(reactiveTxHash);
  const breadcrumb = (
    <>
      {' '}
      <Link to={appRoutes.proof}>Proof explorer</Link>{' '}
      <HugeiconsIcon icon={ArrowRight02Icon} size={12} aria-hidden="true" />{' '}
      <span aria-current="page">Transaction</span>{' '}
    </>
  );

  async function copyHash(hash: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(hash);
      setCopyResult({ hash, ok: true });
    } catch {
      setCopyResult({ hash, ok: false });
    }
  }

  if (!reactiveTxHash) {
    return (
      <section className="app-page">
        <PageHeading
          eyebrow="Proof"
          title="Execution proof"
          description="Trace a rule from the event that triggered it to the outcome on the destination chain."
        />
        <form
          className="app-panel app-panel-pad grid max-w-[46rem] gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const value = lookup.trim().toLowerCase();
            const valid = /^0x[0-9a-f]{64}$/.test(value);
            setLookupInvalid(!valid);
            if (valid) navigate(`/proof/${value}`);
          }}
        >
          <div className="app-panel-header">
            <span className="app-icon">
              <HugeiconsIcon icon={Search01Icon} size={20} aria-hidden="true" />
            </span>
            <div>
              <p className="app-eyebrow">Lookup</p>
              <h2 className="app-panel-heading">Find a transaction</h2>
            </div>
          </div>
          <label htmlFor="proof-hash" className="app-field">
            Reactive transaction hash
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              id="proof-hash"
              value={lookup}
              onChange={(event) => {
                setLookup(event.target.value);
                setLookupInvalid(false);
              }}
              placeholder="0x…"
              spellCheck={false}
              autoCapitalize="off"
              aria-invalid={lookupInvalid || undefined}
              aria-describedby="proof-hash-hint"
              className="app-input font-mono"
            />
            <button type="submit" className="app-button app-button--primary">
              Open proof
            </button>
          </div>
          <p
            id="proof-hash-hint"
            className={lookupInvalid ? 'text-sm text-silent' : 'app-copy'}
            role={lookupInvalid ? 'alert' : undefined}
          >
            {lookupInvalid
              ? 'Enter a complete Lasna transaction hash. It starts with 0x and contains 64 hexadecimal characters.'
              : 'Paste the hash of the Lasna transaction that evaluated your rule.'}
          </p>
        </form>
        <div className="max-w-[46rem]">
          <HowItWorks
            title="How a proof is assembled"
            steps={[
              {
                icon: Activity01Icon,
                title: 'Origin event',
                copy: 'The transaction that matched the rule on the watched network.',
              },
              {
                icon: FlashIcon,
                title: 'Lasna decision',
                copy: 'The agent records whether the rule should run and which path it chose.',
              },
              {
                icon: TransactionHistoryIcon,
                title: 'Settlement',
                copy: 'The vault transaction on the destination chain, linked to its explorer.',
              },
            ]}
          />
        </div>
      </section>
    );
  }

  if (proofQuery.isLoading) {
    return (
      <section aria-busy="true" className="app-page">
        <PageHeading
          eyebrow="Proof"
          title="Execution proof"
          description="Reading the chain…"
          breadcrumb={breadcrumb}
        />
        {[0, 1, 2].map((index) => (
          <div key={index} className="app-skeleton h-28 animate-pulse" />
        ))}
      </section>
    );
  }

  if (proofQuery.error || !proofQuery.data) {
    const copy = proofErrorCopy(proofQuery.error);
    return (
      <section className="app-page">
        <PageHeading eyebrow="Proof" title="Execution proof" breadcrumb={breadcrumb} />
        <ErrorState
          message={copy.title}
          detail={copy.detail}
          onRetry={
            /^0x[0-9a-f]{64}$/i.test(reactiveTxHash) ? () => void proofQuery.refetch() : undefined
          }
        />
        {CHAIN_ONLY_PROOF_ENABLED ? <ChainOnlyProof reactiveTxHash={reactiveTxHash} /> : null}
      </section>
    );
  }

  const proof = proofQuery.data;

  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Proof"
        title="Execution proof"
        description="Follow each step of the execution and open it on the corresponding chain explorer."
        breadcrumb={breadcrumb}
      />

      <div className="app-panel app-panel-pad grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="proof-source"
            data-source={proof.source}
            className="app-tag"
            data-tone={proof.source === 'chain' ? 'positive' : 'warning'}
          >
            {proof.source === 'chain'
              ? 'Live from chain'
              : `Cached proof · ${proof.cache_age_seconds ?? 0}s old`}
          </span>
          {proof.latency_ms !== null && proof.latency_ms !== undefined ? (
            <p className="text-xs text-ink-muted">
              Execution latency{' '}
              <span
                data-testid="proof-latency"
                className="font-mono text-sm font-semibold text-ink"
              >
                {latencyLabel(proof.latency_ms)}
              </span>
            </p>
          ) : null}
        </div>

        <div className="app-divider flex flex-wrap items-center justify-between gap-3 pt-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium">Reactive transaction</p>
            <code className="block break-all font-mono text-xs text-ink-muted">
              {proof.reactive_tx}
            </code>
          </div>
          <button
            type="button"
            onClick={() => void copyHash(proof.reactive_tx)}
            className="app-button"
          >
            <HugeiconsIcon icon={Copy01Icon} size={15} aria-hidden="true" />
            {copyResult?.hash === proof.reactive_tx && copyResult.ok ? 'Copied' : 'Copy hash'}
          </button>
        </div>
        {copyResult?.hash === proof.reactive_tx && !copyResult.ok ? (
          <p role="status" className="app-copy">
            Copy failed. Select the hash to copy it manually.
          </p>
        ) : null}
      </div>

      <ol aria-label="Proof rows" className="app-proof-path app-panel">
        {proof.rows.map((row) => (
          <ProofRow key={`${row.role}-${row.execution_role ?? ''}-${row.tx_hash}`} row={row} />
        ))}
      </ol>

      <p className="app-copy">
        This view is built from Lasna <code className="font-mono">getCallbacks</code> and the two
        public RPCs. Our database is a cache, never the authority.
      </p>

      {CHAIN_ONLY_PROOF_ENABLED ? <ChainOnlyProof reactiveTxHash={proof.reactive_tx} /> : null}
    </section>
  );
}
