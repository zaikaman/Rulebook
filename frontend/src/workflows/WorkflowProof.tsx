import {
  CHAIN_CONFIGS,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowIdSchema,
  workflowV2RunProofSchema,
  type WorkflowV2RunProof,
} from '@rulebook/shared';
import {
  Alert02Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  FlashIcon,
  InformationCircleIcon,
  Pulse01Icon,
  RefreshIcon,
  Search01Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatEther, zeroHash, type Hex } from 'viem';

import { ErrorState } from '@/components/ErrorState';
import { NetworkBadge } from '@/components/NetworkBadge';
import { CopyButton } from '@/components/chrome/CopyButton';
import { EmptyState } from '@/components/chrome/EmptyState';
import { PageHeading } from '@/components/chrome/PageHeading';
import { LoadingRegion, Skeleton } from '@/components/chrome/Skeleton';
import { appRoutes } from '@/lib/routes';
import { workflowClient } from './chainV2';
import { v2ApiBase } from './listingV2';

const proofGuide = [
  {
    icon: Pulse01Icon,
    title: 'Origin event',
    copy: 'The trigger that started the run, or an internal schedule when no external transaction exists.',
  },
  {
    icon: FlashIcon,
    title: 'Lasna decision',
    copy: 'The agent evaluation that selected the path and recorded the outcome.',
  },
  {
    icon: Wallet01Icon,
    title: 'Settlement',
    copy: 'The vault transaction that carried out the approved action, once it settles.',
  },
] as const;

export function WorkflowProofLookup() {
  const inputId = useId();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);

  return (
    <section className="app-page">
      <PageHeading
        title="Workflow proof"
        description="Look up a run to verify its origin, the Lasna decision, and settlement."
      />

      <div className="rb-proof-lookup">
        <form
          className="app-panel rb-proof-lookup-form"
          onSubmit={(event) => {
            event.preventDefault();
            const id = workflowIdSchema.safeParse(input.trim());
            setInvalid(!id.success);
            if (id.success) void navigate(`${appRoutes.runs}/${id.data}`);
          }}
        >
          <header className="rb-panel-head">
            <div className="rb-proof-heading">
              <span className="rb-proof-mark" aria-hidden="true">
                <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={1.7} />
              </span>
              <div>
                <h2 className="rb-panel-title">Find a run</h2>
                <p className="rb-panel-copy">
                  Paste the run ID from Activity or a shared proof link.
                </p>
              </div>
            </div>
          </header>

          <div className="rb-panel-body">
            <label className="app-field" htmlFor={inputId}>
              Run ID
            </label>
            <div className="rb-proof-input-row">
              <div className="rb-search rb-proof-search">
                <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
                <input
                  id={inputId}
                  className="app-input font-mono"
                  placeholder="0x…"
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setInvalid(false);
                  }}
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-invalid={invalid || undefined}
                  aria-describedby={`${inputId}-hint`}
                />
              </div>
              <button type="submit" className="app-button app-button--primary">
                Open proof
                <HugeiconsIcon icon={ArrowRight01Icon} size={15} aria-hidden="true" />
              </button>
            </div>
            <p
              id={`${inputId}-hint`}
              className="rb-proof-hint"
              data-tone={invalid ? 'error' : undefined}
              role={invalid ? 'alert' : undefined}
            >
              {invalid
                ? 'Enter a run ID starting with 0x followed by 64 hexadecimal characters.'
                : 'The run ID is the full hash shown when a workflow run is indexed.'}
            </p>
          </div>
        </form>

        <aside className="app-panel rb-proof-guide" aria-labelledby="proof-guide-title">
          <header className="rb-panel-head">
            <div>
              <h2 id="proof-guide-title" className="rb-panel-title">
                What the proof shows
              </h2>
              <p className="rb-panel-copy">
                A completed run leaves three records, each linked to the chain where it happened.
              </p>
            </div>
          </header>
          <ol className="rb-proof-guide-list">
            {proofGuide.map(({ icon, title, copy }, index) => (
              <li className="rb-proof-guide-item" key={title}>
                <span className="rb-proof-guide-index" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="rb-proof-guide-copy">
                  <p className="rb-proof-guide-title">
                    <HugeiconsIcon icon={icon} size={14} aria-hidden="true" />
                    {title}
                  </p>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
          <footer className="rb-proof-guide-foot">
            <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
            <p>No wallet connection is needed to inspect a proof.</p>
          </footer>
        </aside>
      </div>
    </section>
  );
}

export function WorkflowProof() {
  const { id: raw } = useParams();
  const id = workflowIdSchema.safeParse(raw);
  const proof = useQuery({
    queryKey: ['workflow-v2', 'run-proof', id.data],
    enabled: id.success,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${v2ApiBase}/v3/runs/${id.data}`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Could not load this workflow proof.');
      return workflowV2RunProofSchema.parse(await response.json());
    },
    refetchInterval: ({ state: { data } }) => {
      if (data === null) return 30_000;
      if (data?.status === 'pending' || data?.status === 'in grace period') return 12_000;
      // The indexer can still reconcile a delayed settlement after the run window ends.
      if (
        data?.status === 'expired' &&
        !data.destinationTransaction &&
        Date.now() < data.expiresAt * 1000 + 5 * 60_000
      )
        return 12_000;
      return false;
    },
  });

  return (
    <section className="app-page">
      <PageHeading
        title="Workflow run proof"
        description="Chain records indexed from the configured Workflow V2 deployment."
        aside={
          <div className="rb-action-row">
            {proof.data && proof.data.status !== 'confirmed' && (
              <button
                className="app-button"
                type="button"
                disabled={proof.isFetching}
                onClick={() => void proof.refetch()}
              >
                <HugeiconsIcon icon={RefreshIcon} size={15} aria-hidden="true" />
                {proof.isFetching ? 'Refreshing…' : 'Refresh proof'}
              </button>
            )}
            <Link className="app-button" to={appRoutes.proof}>
              Find another run
            </Link>
          </div>
        }
      />

      {!id.success ? (
        <ErrorState message="This run ID is invalid.">
          <Link to={appRoutes.proof} className="app-link">
            Find a run by ID
          </Link>
        </ErrorState>
      ) : proof.isPending ? (
        <LoadingRegion label="Loading workflow proof…" className="rb-proof-loading">
          <Skeleton className="rb-skeleton--proof-summary" />
          <Skeleton className="rb-skeleton--proof-row" />
          <Skeleton className="rb-skeleton--proof-row" />
          <Skeleton className="rb-skeleton--proof-row" />
        </LoadingRegion>
      ) : proof.isError ? (
        <ErrorState
          message="The workflow proof could not be loaded."
          onRetry={() => void proof.refetch()}
        />
      ) : proof.data ? (
        <ProofDetails run={proof.data} />
      ) : (
        <EmptyState
          icon={Search01Icon}
          title="Run not indexed yet"
          description="Check the run ID. If it just ran, the proof will appear after indexing."
          action={
            <button className="app-button" type="button" onClick={() => void proof.refetch()}>
              Check again
            </button>
          }
        />
      )}
    </section>
  );
}

function ProofDetails({ run }: { run: WorkflowV2RunProof }) {
  const proofUrl = new URL(`${appRoutes.runs}/${run.id}`, window.location.origin).href;
  const provisionalExpiry = run.status === 'expired' && !run.destinationTransaction;
  const steps = [
    { label: 'Origin event', chain: run.originChain, hash: run.originTransaction },
    { label: 'Lasna decision', chain: LASNA_CHAIN_ID, hash: run.lasnaTransaction },
    { label: 'Settlement', chain: run.chain, hash: run.destinationTransaction },
  ];
  const statusLabel = provisionalExpiry ? 'Settlement window elapsed' : run.status;
  const tone = statusTone(run.status, provisionalExpiry);
  const recorded = steps.filter(({ hash }) => hash && hash !== zeroHash).length;

  return (
    <div className="rb-proof-layout">
      <section className="app-panel rb-proof-summary" aria-label="Run outcome">
        <header className="rb-panel-head">
          <div className="rb-proof-summary-heading">
            <span className="rb-proof-summary-icon" data-tone={tone} aria-hidden="true">
              <HugeiconsIcon icon={statusIcon(run.status)} size={18} strokeWidth={1.7} />
            </span>
            <div>
              <h2 className="rb-panel-title">Run outcome</h2>
              <p className="rb-panel-copy">
                {run.reason
                  ? 'The indexed result and its recorded reason.'
                  : 'The indexed result of this run.'}
              </p>
            </div>
          </div>
          <span className="rb-chip" data-tone={tone}>
            <span className="rb-proof-status">{statusLabel}</span>
          </span>
        </header>

        <div className="rb-panel-body">
          {run.reason && (
            <div className="rb-proof-reason">
              <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
              <p>{run.reason}</p>
            </div>
          )}
          <dl className="rb-spec-facts">
            <div>
              <dt>Path</dt>
              <dd>{run.path !== null ? `Path ${run.path + 1}` : 'No action path'}</dd>
            </div>
            <div>
              <dt>Origin network</dt>
              <dd>
                <NetworkBadge chainId={run.originChain} />
              </dd>
            </div>
            <div>
              <dt>Settlement network</dt>
              <dd>
                <NetworkBadge chainId={run.chain} />
              </dd>
            </div>
          </dl>

          <div className="rb-proof-identifiers">
            <div className="rb-proof-identifier">
              <span>Run ID</span>
              <div>
                <code>{run.id}</code>
                <CopyButton label="run ID" value={run.id} />
              </div>
            </div>
            <div className="rb-proof-identifier">
              <span>Program hash</span>
              <div>
                <code>{run.programHash}</code>
                <CopyButton label="program hash" value={run.programHash} />
              </div>
            </div>
          </div>
        </div>

        <footer className="rb-proof-summary-foot">
          <div className="rb-proof-share">
            <CopyButton label="proof link" value={proofUrl} />
            <span>Share proof link</span>
          </div>
          <Link className="app-link" to={`${appRoutes.activity}?run=${run.id}`}>
            Open run in Activity
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden="true" />
          </Link>
        </footer>
      </section>

      <section className="app-panel rb-proof-trail" aria-labelledby="proof-trail-title">
        <header className="rb-panel-head">
          <div>
            <h2 id="proof-trail-title" className="rb-panel-title">
              Proof trail
            </h2>
            <p className="rb-panel-copy">
              Follow the run from its trigger to the vault action that settled it.
            </p>
          </div>
          <span className="rb-chip rb-chip--plain">{recorded} / 3 recorded</span>
        </header>

        <ol className="rb-proof-stages" aria-label="Run transactions">
          {steps.map(({ label, chain, hash }, index) => {
            const present = Boolean(hash && hash !== zeroHash);
            const role = chain === LASNA_CHAIN_ID ? 'automation' : 'funds';
            const missing =
              label === 'Origin event'
                ? 'No external transaction recorded.'
                : 'No settlement transaction recorded.';
            return (
              <li
                className="rb-proof-stage"
                data-state={present ? 'recorded' : 'missing'}
                key={label}
              >
                <span className="rb-proof-stage-marker" data-chain-role={role} aria-hidden="true">
                  {index + 1}
                </span>
                <div className="rb-proof-stage-body">
                  <header className="rb-proof-stage-head">
                    <div className="rb-proof-stage-identity">
                      <h3 className="rb-proof-stage-title">{label}</h3>
                      {chain > 0 && <NetworkBadge chainId={chain} />}
                    </div>
                    <span className="rb-proof-stage-state">
                      {present ? 'Recorded' : 'Not recorded'}
                    </span>
                  </header>
                  {present && hash ? (
                    <>
                      <ProofTransaction chain={chain} hash={hash} />
                      {label === 'Origin event' && (
                        <p className="rb-proof-log">Log index {run.originLogIndex}</p>
                      )}
                    </>
                  ) : (
                    <p className="rb-proof-stage-missing">{missing}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <footer className="rb-proof-trail-foot">
          <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
          <p>
            Transaction execution gas uses each receipt. Network credit charges and data fees are
            billed separately.
          </p>
        </footer>
      </section>
    </div>
  );
}

function statusTone(
  status: WorkflowV2RunProof['status'],
  provisionalExpiry: boolean,
): 'active' | 'danger' | 'paused' | 'info' | undefined {
  if (provisionalExpiry) return 'paused';
  if (status === 'confirmed') return 'active';
  if (status === 'failed') return 'danger';
  if (status === 'expired' || status === 'skipped') return 'paused';
  if (status === 'pending' || status === 'in grace period') return 'info';
  return undefined;
}

function statusIcon(status: WorkflowV2RunProof['status']) {
  if (status === 'confirmed') return CheckmarkCircle02Icon;
  if (status === 'failed' || status === 'expired') return Alert02Icon;
  return Clock01Icon;
}

function ProofTransaction({ chain, hash }: { chain: number; hash: Hex }) {
  const network = CHAIN_CONFIGS.get(chain);
  const supported = chain === LASNA_CHAIN_ID || chain === UNICHAIN_SEPOLIA_CHAIN_ID;
  const executionGas = useQuery({
    queryKey: ['workflow-v2', 'proof-execution-gas', chain, hash],
    enabled: supported,
    queryFn: async () => {
      const { gasUsed, effectiveGasPrice } = await workflowClient(
        chain as typeof LASNA_CHAIN_ID | typeof UNICHAIN_SEPOLIA_CHAIN_ID,
      ).getTransactionReceipt({ hash });
      // Some Lasna receipts omit the effective price even when gas usage is recorded.
      return typeof gasUsed === 'bigint' && typeof effectiveGasPrice === 'bigint'
        ? gasUsed * effectiveGasPrice
        : null;
    },
    staleTime: Infinity,
    retry: false,
  });
  const cost = executionGas.data;

  return (
    <div className="rb-proof-transaction">
      {network ? (
        <a
          className="rb-proof-tx-hash"
          href={`${network.explorerUrl}/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
        >
          {hash}
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} aria-hidden="true" />
        </a>
      ) : (
        <code className="rb-proof-tx-hash">{hash}</code>
      )}
      {typeof cost === 'bigint' ? (
        <p className="rb-proof-gas">
          Transaction execution gas {formatEther(cost)}{' '}
          {chain === LASNA_CHAIN_ID ? 'lREACT' : 'ETH'}
        </p>
      ) : cost === null || executionGas.isError ? (
        <p className="rb-proof-gas">Transaction execution gas unavailable.</p>
      ) : supported && executionGas.isPending ? (
        <p className="rb-proof-gas">Reading transaction execution gas…</p>
      ) : null}
    </div>
  );
}
