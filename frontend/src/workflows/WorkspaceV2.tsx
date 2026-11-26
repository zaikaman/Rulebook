import {
  automationChainFor,
  decodeWorkflowV2,
  executionCreditAbi,
  fundsChainIdSchema,
  getChain,
  isFundsChain,
  networkModeForChain,
  readAmount,
  workflowIdSchema,
  workflowV2RunStatusSchema,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowVaultV2Abi,
  workflowV2Action,
  type NetworkMode,
} from '@rulebook/shared';
import {
  Add01Icon,
  Alert02Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Book02Icon,
  Clock01Icon,
  Coins01Icon,
  InformationCircleIcon,
  Pulse01Icon,
  RefreshIcon,
  Shield01Icon,
  Store01Icon,
  Tick02Icon,
  TradeUpIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { z } from 'zod';

import { PageHeading } from '@/components/chrome/PageHeading';
import { WalletControl } from '@/components/chrome/WalletControl';
import { WalletAccountSetupGate } from '@/components/AccountSetupGate';
import { AppShell } from '@/components/AppShell';
import { CopyButton } from '@/components/chrome/CopyButton';
import { EmptyState } from '@/components/chrome/EmptyState';
import { HowItWorks } from '@/components/chrome/HowItWorks';
import { MainnetUnavailableCallout } from '@/components/MainnetUnavailableCallout';
import {
  CardGridSkeleton,
  FeedSkeleton,
  LoadingRegion,
  MetricsSkeleton,
  Skeleton,
} from '@/components/chrome/Skeleton';
import { Spinner } from '@/components/chrome/Spinner';
import { ErrorState } from '@/components/ErrorState';
import { NetworkBadge } from '@/components/NetworkBadge';
import { TelegramNotifications } from '@/components/TelegramNotifications';
import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { Badge, Button, Callout, Select } from '@/ui';
import { appRoutes } from '@/lib/routes';
import { V2Feedback, V2Field, WorkflowProgramSummary } from './BuilderV2';
import {
  configuredFundsChains,
  readAgent,
  readFundsV2,
  readVault,
  readWorkflowsV2,
  readWorkflowV2,
  settlementFactory,
  useWorkflowV2Wallet,
  v2Explorer,
  v2Network,
  workflowActivationEnabled,
  workflowClient,
  type SettlementChain,
} from './chainV2';
import { toDraft } from './modelV2';
import { WorkflowCanvas } from './Graph';
import { canvasLeaf, diagramV2 } from './diagramV2';
import { v2ApiBase } from './listingV2';
import { WorkflowCreditNotice } from './WorkflowCredit';
import { useWorkflowHealth, workflowHealthHref, shortRun } from './health';
import { WorkflowHealthPanel } from './WorkflowHealth';
import { WorkflowWeeklyBudget } from './WeeklyBudget';

export function WorkflowsV2() {
  const { mode, isMainnet, automationName, isDeploymentConfigured } = useNetworkMode();
  const { owner } = useWorkflowV2Wallet();
  const rows = useQuery({
    queryKey: ['workflow-v2', 'workflows', mode, owner],
    enabled: Boolean(owner && isDeploymentConfigured),
    queryFn: () => readWorkflowsV2(owner!, mode),
    refetchInterval: 12_000,
  });
  const workflows = rows.data ?? [];
  const health = useWorkflowHealth(owner, rows.data);
  const activeCount = workflows.filter((row) => row.active).length;
  const attention = workflows.filter(
    (row) => health.rows.get(row.id)?.health.attention ?? !row.active,
  ).length;

  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Automation"
        title="Workflows"
        description={
          isMainnet
            ? 'Build, activate, and monitor the mainnet automations that run from your wallet.'
            : 'Build, activate, and monitor the testnet automations that run from your wallet.'
        }
        aside={
          <Link className="app-button app-button--primary" to="/workflows/new">
            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
            New workflow
          </Link>
        }
      />

      {!isDeploymentConfigured &&
        (isMainnet ? (
          <MainnetUnavailableCallout context="Workflow execution" />
        ) : (
          <p className="rb-note">
            <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
            Testnet activation is being configured. You can still browse recipes and build a draft.
          </p>
        ))}

      {!owner && isDeploymentConfigured && (
        <Callout title="Connect a wallet to load your workflows" action={<WalletControl setup />}>
          <p>Your agent, vault, and run history all belong to the connected wallet.</p>
        </Callout>
      )}

      {!owner && (
        <HowItWorks
          title="How a workflow runs"
          steps={[
            {
              icon: Pulse01Icon,
              title: 'Trigger',
              copy: 'A schedule, price move, or wallet event tells the agent when to evaluate.',
            },
            {
              icon: Shield01Icon,
              title: 'Checks',
              copy: 'Conditions and spending caps decide whether the run may continue.',
            },
            {
              icon: TradeUpIcon,
              title: 'Actions',
              copy: `Your vault executes the swap, transfer, or alert on ${configuredFundsChains(
                mode,
              )
                .map((id) => getChain(id).name)
                .join(' or ')}.`,
            },
          ]}
        />
      )}

      {rows.error && (
        <div className="rb-alert" role="alert">
          <span>{rows.error.message}</span>
          <button type="button" onClick={() => void rows.refetch()}>
            Try again
          </button>
        </div>
      )}

      {health.runsUnavailable && (
        <p className="app-alert" data-tone="warning" role="status">
          Run history could not be loaded. Statuses still reflect the workflow and credit state.
        </p>
      )}

      {workflows.length > 0 && <WorkflowCreditNotice owner={owner} />}

      {!!owner && !!rows.data && (
        <div className="rb-metrics">
          <div className="rb-metric">
            <p className="rb-metric-label">Workflows</p>
            <p className="rb-metric-value">{workflows.length}</p>
            <p className="rb-metric-note">
              {configuredFundsChains(mode).length > 1
                ? 'Saved across your vaults'
                : 'Saved in this vault'}
            </p>
          </div>
          <div className="rb-metric" data-tone="active">
            <p className="rb-metric-label">Active</p>
            <p className="rb-metric-value">{activeCount}</p>
            <p className="rb-metric-note">Enabled on {automationName}</p>
          </div>
          <div className="rb-metric">
            <p className="rb-metric-label">Needs attention</p>
            <p className="rb-metric-value">{attention}</p>
            <p className="rb-metric-note">Blocked, failed, or not active</p>
          </div>
        </div>
      )}

      {!!owner && isDeploymentConfigured && rows.isPending && (
        <LoadingRegion label="Reading your workflows…" className="rb-page-skeleton">
          <MetricsSkeleton />
          <CardGridSkeleton count={2} />
        </LoadingRegion>
      )}

      {!!owner && rows.data?.length === 0 && (
        <EmptyState
          icon={Book02Icon}
          title="No workflows yet"
          description="A workflow watches for a trigger, checks your conditions, then acts from your vault. Start from a recipe or build the logic yourself."
          action={
            <>
              <Link className="app-button app-button--primary" to="/workflows/new">
                Build a workflow
              </Link>
              <Link className="app-button" to="/marketplace">
                Browse Marketplace
              </Link>
            </>
          }
          steps={['Pick a trigger', 'Add checks and actions', 'Review and activate']}
        />
      )}

      {!!workflows.length && (
        <ul className="rb-card-grid">
          {workflows.map((row) => {
            const view = health.rows.get(row.id);
            const ready = !row.active && row.staged && row.auth[3];
            const tone =
              view?.health.tone ??
              (row.closed
                ? 'info'
                : row.active
                  ? 'active'
                  : row.partiallyPaused
                    ? 'danger'
                    : ready
                      ? 'info'
                      : 'paused');
            const label =
              view?.health.label ??
              (row.closed
                ? 'Completed'
                : row.active
                  ? 'Watching'
                  : row.partiallyPaused
                    ? `Still watching on ${automationName}`
                    : ready
                      ? 'Ready to activate'
                      : 'Paused');
            const summary =
              view?.health.summary ??
              (row.closed
                ? 'This workflow has finished its one-time run. Its history remains available.'
                : row.active
                  ? 'This workflow is active and waiting for its next trigger.'
                  : row.partiallyPaused
                    ? `Vault spending is revoked, but ${automationName} is still watching for triggers. Finish pausing so it stops using watching credit.`
                    : ready
                      ? 'The Vault authorization is staged. Finish activation to start watching.'
                      : 'This workflow is not watching for events.');
            const fixHref = view
              ? workflowHealthHref(view.health, row.id, view.lastRun?.id, view.chain)
              : undefined;
            return (
              <li key={row.id}>
                <div className="rb-card">
                  <Link to={`/workflows/${row.id}`} className="rb-card-body">
                    <div className="rb-card-head">
                      <span className="rb-card-icon" aria-hidden="true">
                        <HugeiconsIcon icon={Book02Icon} size={18} strokeWidth={1.7} />
                      </span>
                      <div className="rb-card-heading">
                        <h2 className="rb-card-title">{row.title}</h2>
                        <p className="rb-card-meta">
                          <NetworkBadge chainId={row.chain} />
                        </p>
                      </div>
                    </div>
                    <div className="grid justify-items-start gap-1.5">
                      <Badge
                        tone={tone}
                        className="max-w-full whitespace-normal [overflow-wrap:anywhere]"
                      >
                        {label}
                      </Badge>
                      <p className="rb-card-copy">{summary}</p>
                    </div>
                  </Link>
                  <div className="rb-card-foot flex-wrap">
                    <span>
                      {view?.lastSuccess ? (
                        <>
                          Last success{' '}
                          <Link
                            className="app-link"
                            to={withNetworkQuery(`${appRoutes.runs}/${view.lastSuccess.id}`, mode)}
                          >
                            {shortRun(view.lastSuccess.id)}
                          </Link>
                        </>
                      ) : health.pending ? (
                        'Checking run history…'
                      ) : (
                        'No successful run yet'
                      )}
                    </span>
                    {fixHref && view?.health.fixLabel ? (
                      <Link className="app-link" to={fixHref}>
                        {view.health.fixLabel}
                      </Link>
                    ) : (
                      <span className="rb-card-cue">
                        Open
                        <HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function WorkflowDetailV2() {
  const { mode, isMainnet, automationName, isDeploymentConfigured } = useNetworkMode();
  const { id: raw } = useParams();
  const id = workflowIdSchema.safeParse(raw);
  const wallet = useWorkflowV2Wallet();
  const data = useQuery({
    queryKey: ['workflow-v2', 'detail', mode, wallet.owner, raw],
    enabled: Boolean(wallet.owner && id.success && isDeploymentConfigured),
    queryFn: () => readWorkflowV2(wallet.owner!, id.data!, mode),
    refetchInterval: 12_000,
  });
  if (!id.success) return <p role="alert">This workflow link is invalid.</p>;
  if (!isDeploymentConfigured) {
    return isMainnet ? (
      <MainnetUnavailableCallout context="Workflow details" />
    ) : (
      <p className="rb-note">Contracts are not configured for {automationName}.</p>
    );
  }
  if (!wallet.owner)
    return (
      <section className="app-page">
        <PageHeading title="Workflow" />
        <WalletControl setup />
      </section>
    );
  if (data.error)
    return (
      <p className="workflow-error" role="alert">
        {data.error.message}
      </p>
    );
  if (!data.data)
    return (
      <section className="app-page">
        <PageHeading
          eyebrow="Workflow"
          title="Workflow"
          description="Reading the program, its activation state, and the path it settles through."
        />
        <LoadingRegion label="Reading your workflow…" className="rb-page-skeleton">
          <div className="rb-page-skeleton-toolbar">
            <Skeleton className="rb-skeleton--chip" />
            <Skeleton className="rb-skeleton--chip" />
          </div>
          <Skeleton className="rb-skeleton--canvas" />
          <Skeleton className="rb-skeleton--panel" />
        </LoadingRegion>
      </section>
    );
  const item = data.data;
  const program = decodeWorkflowV2(item.program);
  const payout = program.nodes.some((node) =>
    node.actions.some((step) => step.kind === workflowV2Action.inactivityPayout),
  );
  const active = item.active;
  const status = item.closed
    ? 'Closed after a confirmed run'
    : active
      ? 'Active'
      : item.partiallyPaused
        ? `Still watching on ${automationName}`
        : item.auth[3]
          ? 'Finish activation'
          : 'Paused';
  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Workflow"
        title={item.title}
        description="Review the program, its activation state, and the path it settles through."
        aside={
          <div className="rb-inline">
            <NetworkBadge chainId={item.chain} />
            <span
              className="rb-chip"
              data-tone={
                item.closed || active
                  ? 'active'
                  : item.partiallyPaused
                    ? 'danger'
                    : item.auth[3]
                      ? 'info'
                      : 'paused'
              }
            >
              {status}
            </span>
          </div>
        }
      />
      <div className="workflow-actions">
        {!item.closed && (
          <Link className="app-button" to={`/workflows/${item.id}/edit`}>
            {active ? 'Edit workflow' : 'Review and activate'}
          </Link>
        )}
        {!item.closed && (item.auth[3] || item.entry[4] !== 0) && (
          <button
            type="button"
            className="app-button"
            disabled={wallet.busy}
            onClick={() => void wallet.pause(item)}
          >
            {item.partiallyPaused ? 'Finish pausing' : 'Pause workflow'}
          </button>
        )}
        {active && payout && (
          <button
            className="app-button"
            type="button"
            disabled={wallet.busy}
            onClick={() =>
              void wallet.perform(async () => {
                await wallet.send(
                  item.chain,
                  item.vault,
                  encodeFunctionData({
                    abi: workflowVaultV2Abi,
                    functionName: 'checkIn',
                    args: [item.id],
                  }),
                  'Check in now and clear any pending inactivity payout.',
                );
              })
            }
          >
            Check in
          </button>
        )}
        <Link to={`${appRoutes.activity}?workflow=${item.id}`} className="app-button">
          Activity
        </Link>
      </div>
      <WorkflowHealthPanel item={item} owner={wallet.owner} />
      <WorkflowWeeklyBudget item={item} wallet={wallet} />
      {!item.closed && <WorkflowCreditNotice owner={wallet.owner} chain={item.chain} />}
      <div className="rb-canvas-panel">
        <WorkflowCanvas draft={diagramV2(toDraft(program, item.title)).canvas} />
        <div className="rb-panel-body">
          <WorkflowProgramSummary draft={toDraft(program, item.title)} />
        </div>
      </div>
      {!item.staged && <Publication item={item} wallet={wallet} />}
      {item.entry[1] > 0n && (
        <TelegramNotifications
          workflow
          agent={item.agent}
          owner={wallet.owner}
          workflowId={item.id}
        />
      )}
      <V2Feedback wallet={wallet} />
    </section>
  );
}

function Publication({
  item,
  wallet,
}: {
  item: Awaited<ReturnType<typeof readWorkflowV2>>;
  wallet: ReturnType<typeof useWorkflowV2Wallet>;
}) {
  const { mode, automationChainId, deployment } = useNetworkMode();
  const [description, setDescription] = useState('');
  const factory = deployment?.automationFactory;
  const reader = workflowClient(automationChainId);
  const listing = useQuery({
    queryKey: ['workflow-v2', 'publication', mode, item.id, item.entry[0]],
    enabled: Boolean(factory),
    queryFn: async () => {
      const id = await reader.readContract({
        address: factory!,
        abi: workflowAgentFactoryV2Abi,
        functionName: 'listingOf',
        args: [item.agent, item.id, item.entry[0]],
      });
      if (!id) return null;
      const [, , , , visible] = await reader.readContract({
        address: factory!,
        abi: workflowAgentFactoryV2Abi,
        functionName: 'listings',
        args: [id],
      });
      return { id, visible };
    },
  });
  if (!factory) return null;
  const published = listing.data;
  const publicListing = Boolean(published?.visible);
  const listingUnavailable = Boolean(listing.error) && !published;
  const checking = listing.isPending && !published && !listingUnavailable;
  const listingLabel = publicListing
    ? 'Listed'
    : listingUnavailable
      ? 'Unavailable'
      : checking
        ? 'Checking'
        : 'Not listed';
  const listingCopy = publicListing
    ? 'This version is visible to other wallets in the Marketplace.'
    : listingUnavailable
      ? 'The Marketplace registry could not be read.'
      : checking
        ? 'Checking whether this version is public.'
        : 'Publish this version so other wallets can inspect and copy it.';
  const descriptionBytes = new TextEncoder().encode(description).length;
  const descriptionTooLong = descriptionBytes > 280;
  return (
    <section className="app-panel rb-publication" aria-labelledby="marketplace-listing-title">
      <header className="rb-panel-head">
        <div className="rb-publication-identity">
          <span className="rb-publication-icon" aria-hidden="true">
            <HugeiconsIcon icon={Store01Icon} size={18} strokeWidth={1.7} />
          </span>
          <div>
            <h2 className="rb-panel-title" id="marketplace-listing-title">
              Marketplace listing
            </h2>
            <p className="rb-panel-copy">{listingCopy}</p>
          </div>
        </div>
        <span
          className="rb-chip"
          data-tone={publicListing ? 'info' : listingUnavailable ? 'danger' : undefined}
        >
          {listingLabel}
        </span>
      </header>
      {publicListing && published ? (
        <>
          <div className="rb-publication-body">
            <div className="rb-publication-banner" data-tone="public">
              <span className="rb-publication-mark" aria-hidden="true">
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} strokeWidth={1.8} />
              </span>
              <p className="rb-publication-copy">
                <strong>Anyone with the link can open it.</strong> They can review the program and
                copy it as their own draft. Unpublishing hides the listing without stopping this
                workflow.
              </p>
            </div>
            <dl className="rb-spec-facts">
              <div>
                <dt>Listing</dt>
                <dd className="rb-publication-id">#{published.id.toString()}</dd>
              </div>
              <div>
                <dt>Settlement network</dt>
                <dd>
                  <NetworkBadge chainId={item.chain} />
                </dd>
              </div>
              <div>
                <dt>Visibility</dt>
                <dd>Public</dd>
              </div>
            </dl>
          </div>
          <footer className="rb-publication-foot">
            <Link
              className="app-button app-button--primary"
              to={withNetworkQuery(`/marketplace/${published.id}`, mode)}
            >
              View listing
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="app-button app-button--danger"
              disabled={wallet.busy}
              onClick={() =>
                void wallet.perform(async () => {
                  await wallet.send(
                    automationChainId,
                    factory,
                    encodeFunctionData({
                      abi: workflowAgentFactoryV2Abi,
                      functionName: 'unpublish',
                      args: [published.id],
                    }),
                    'Remove this version from the public Marketplace.',
                  );
                })
              }
            >
              Unpublish
            </button>
          </footer>
        </>
      ) : listingUnavailable ? (
        <div className="rb-publication-body">
          <div className="rb-publication-banner" data-tone="error" role="alert">
            <span className="rb-publication-mark" aria-hidden="true">
              <HugeiconsIcon icon={Alert02Icon} size={15} strokeWidth={1.8} />
            </span>
            <div className="rb-publication-error-copy">
              <p className="rb-publication-copy">
                <strong>Marketplace status is unavailable.</strong> {listing.error?.message}
              </p>
              <button
                type="button"
                className="app-button app-button--quiet"
                disabled={listing.isFetching}
                onClick={() => void listing.refetch()}
              >
                {listing.isFetching && <Spinner />}
                {listing.isFetching ? 'Checking' : 'Check again'}
              </button>
            </div>
          </div>
        </div>
      ) : checking ? (
        <div className="rb-publication-body" aria-live="polite">
          <div className="rb-publication-banner">
            <span className="rb-publication-mark" aria-hidden="true">
              <Spinner />
            </span>
            <p className="rb-publication-copy">
              Checking the Marketplace registry for this version.
            </p>
          </div>
        </div>
      ) : (
        <form
          className="rb-publication-form"
          onSubmit={(event) => {
            event.preventDefault();
            void wallet.perform(async () => {
              const text = description.trim();
              if (!text || new TextEncoder().encode(text).length > 280)
                throw new Error('Enter a description of up to 280 bytes.');
              await wallet.send(
                automationChainId,
                factory,
                encodeFunctionData({
                  abi: workflowAgentFactoryV2Abi,
                  functionName: 'publish',
                  args: [item.id, text],
                }),
                `Publish this workflow version in the ${mode} Marketplace.`,
              );
              setDescription('');
            });
          }}
        >
          <div className="rb-publication-body">
            <div className="rb-publication-banner">
              <span className="rb-publication-mark" aria-hidden="true">
                <HugeiconsIcon icon={InformationCircleIcon} size={15} strokeWidth={1.8} />
              </span>
              <p className="rb-publication-copy">
                Add a description so other wallets know what this workflow does. The workflow title
                is published with it, and you can unpublish at any time.
              </p>
            </div>
            <label className="app-field">
              <span className="rb-publication-label">
                <span>Public description</span>
                <span
                  className="rb-publication-count"
                  data-tone={descriptionTooLong ? 'danger' : undefined}
                >
                  {descriptionBytes}/280 bytes
                </span>
              </span>
              <textarea
                className="app-input rb-publication-input"
                rows={4}
                maxLength={280}
                value={description}
                placeholder="Describe when this workflow runs and what it does."
                aria-invalid={descriptionTooLong || undefined}
                aria-describedby="marketplace-description-help"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <p
              className="rb-publication-hint"
              data-tone={descriptionTooLong ? 'error' : undefined}
              id="marketplace-description-help"
            >
              {descriptionTooLong
                ? 'Shorten the description to 280 bytes or fewer.'
                : 'Shown with the listing in the Marketplace.'}
            </p>
          </div>
          <footer className="rb-publication-foot">
            <button
              className="app-button app-button--primary"
              type="submit"
              disabled={
                wallet.busy || listing.isPending || !description.trim() || descriptionTooLong
              }
            >
              {wallet.busy ? 'Publishing…' : 'Publish version'}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}

const settlementChainSchema = fundsChainIdSchema;
const runSchema = z.object({
  id: workflowIdSchema,
  workflowId: workflowIdSchema,
  title: z.string(),
  chain: settlementChainSchema,
  originChain: z.number().int(),
  originTransaction: workflowIdSchema,
  lasnaTransaction: workflowIdSchema,
  destinationTransaction: workflowIdSchema.nullable(),
  expiresAt: z.number().int(),
  status: workflowV2RunStatusSchema,
  reason: z.string().nullable(),
  path: z.number().int().nullable(),
  agent: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/i)
    .transform((value) => value as Address),
  programHash: workflowIdSchema,
});
const activityPage = z.object({ runs: z.array(runSchema), nextCursor: z.string().nullable() });

function TransactionLink({
  chain,
  hash,
  label,
}: {
  chain: number;
  hash: Hex | null;
  label: string;
}) {
  const href = hash && v2Explorer(chain, hash);
  return href ? (
    <a className="app-link" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : null;
}

type ActivityFilter = 'all' | 'pending' | 'confirmed' | 'other';

const activityFilters = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'other', label: 'Other' },
] as const satisfies readonly { readonly id: ActivityFilter; readonly label: string }[];

const activityFilterStatuses = {
  pending: new Set(['pending', 'in grace period']),
  confirmed: new Set(['confirmed']),
  other: new Set(['skipped', 'expired', 'failed']),
} as const satisfies Record<Exclude<ActivityFilter, 'all'>, ReadonlySet<string>>;

export function WorkflowActivityV2() {
  const wallet = useWorkflowV2Wallet();
  const { mode, isMainnet, automationName, isDeploymentConfigured } = useNetworkMode();
  const [params] = useSearchParams();
  const run = params.get('run');
  const workflow = params.get('workflow');
  const scopes = z
    .object({ run: workflowIdSchema.nullable(), workflow: workflowIdSchema.nullable() })
    .safeParse({ run, workflow });
  const requestedId = scopes.data?.run;
  const workflowId = scopes.data?.workflow;
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['workflow-v2', 'activity', mode, wallet.owner, workflowId, requestedId],
    enabled: Boolean(wallet.owner && isDeploymentConfigured && scopes.success),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        network: mode,
        owner: wallet.owner!,
        ...(requestedId ? { id: requestedId } : {}),
        ...(workflowId ? { workflow: workflowId } : {}),
        ...(pageParam ? { after: pageParam } : {}),
      });
      const response = await fetch(`${v2ApiBase}/v3/activity?${params}`, { signal });
      if (!response.ok) throw new Error('Couldn’t read workflow activity.');
      return activityPage.parse(await response.json());
    },
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (state) => ((state.state.data?.pages.length ?? 0) <= 1 ? 12_000 : false),
  });
  if (!scopes.success) {
    return (
      <section className="app-page">
        <ErrorState message="The Activity filter is invalid.">
          <Link className="app-link" to={appRoutes.activity}>
            Open Activity
          </Link>
        </ErrorState>
      </section>
    );
  }
  const rows = query.data?.pages.flatMap((page) => page.runs) ?? [];
  const visible =
    requestedId || filter === 'all'
      ? rows
      : rows.filter((run) => activityFilterStatuses[filter].has(run.status));
  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Automation"
        title={requestedId ? 'Run details' : workflowId ? 'Workflow activity' : 'Activity'}
        description={`Follow each run from the origin event through the ${automationName} decision to settlement.`}
        aside={
          <>
            {wallet.owner && <span className="rb-chip rb-chip--plain">{rows.length} loaded</span>}
            <button
              type="button"
              className="app-button"
              disabled={refreshing || !wallet.owner || !isDeploymentConfigured}
              onClick={() => {
                setRefreshing(true);
                void query.refetch().finally(() => setRefreshing(false));
              }}
            >
              {refreshing ? (
                <Spinner />
              ) : (
                <HugeiconsIcon icon={RefreshIcon} size={15} aria-hidden="true" />
              )}
              {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </>
        }
      />

      {(workflowId || requestedId) && (
        <div className="rb-inline">
          {workflowId && (
            <Link className="app-link" to={`${appRoutes.workflows}/${workflowId}`}>
              {rows[0]?.title ?? 'Open workflow'}
            </Link>
          )}
          <Link className="app-link" to={appRoutes.activity}>
            All activity
          </Link>
        </div>
      )}

      {!wallet.owner && (
        <Callout title="Connect a wallet to read its runs" action={<WalletControl setup />}>
          <p>Activity is scoped to the wallet that owns the agent and vault.</p>
        </Callout>
      )}

      {!wallet.owner && (
        <HowItWorks
          title="What each run records"
          steps={[
            {
              icon: Pulse01Icon,
              title: 'Origin event',
              copy: 'The transaction that matched the trigger on the watched network.',
            },
            {
              icon: Shield01Icon,
              title: isMainnet ? 'Reactive Mainnet decision' : 'Lasna decision',
              copy: 'The agent evaluates the checks and records which path it chose.',
            },
            {
              icon: Wallet01Icon,
              title: 'Settlement',
              copy: 'The vault executes the approved action and the run is confirmed.',
            },
          ]}
        />
      )}

      {!isDeploymentConfigured &&
        (isMainnet ? (
          <MainnetUnavailableCallout context="Activity" />
        ) : (
          <p className="rb-note">
            <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
            Activity opens when the V2 testnet deployment is configured.
          </p>
        ))}

      {query.error && (
        <div className="rb-alert" role="alert">
          <span>{query.error.message}</span>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}

      {query.isPending && Boolean(wallet.owner) && isDeploymentConfigured && (
        <LoadingRegion label="Loading workflow activity…" className="rb-page-skeleton">
          <div className="rb-page-skeleton-toolbar">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton className="rb-skeleton--chip" key={index} />
            ))}
          </div>
          <FeedSkeleton count={3} />
        </LoadingRegion>
      )}

      {!!wallet.owner && !requestedId && query.isSuccess && rows.length > 0 && (
        <div className="rb-toolbar">
          <div className="rb-filters" role="group" aria-label="Filter runs">
            {activityFilters.map((option) => (
              <button
                key={option.id}
                type="button"
                className="rb-filter"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
                <span className="rb-filter-count">
                  {option.id === 'all'
                    ? rows.length
                    : rows.filter((run) => activityFilterStatuses[option.id].has(run.status))
                        .length}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {query.isSuccess && !rows.length && (
        <EmptyState
          icon={Clock01Icon}
          title={requestedId ? 'Run unavailable for this wallet' : 'No runs yet'}
          description={
            requestedId
              ? 'Open the public proof to check whether this run has been indexed.'
              : 'Runs appear here once a trigger fires and the agent evaluates the workflow’s conditions.'
          }
          action={
            <Link
              className="app-button"
              to={
                requestedId
                  ? withNetworkQuery(`${appRoutes.runs}/${requestedId}`, mode)
                  : workflowId
                    ? `${appRoutes.workflows}/${workflowId}`
                    : appRoutes.workflows
              }
            >
              {requestedId ? 'Open public proof' : workflowId ? 'Open workflow' : 'View workflows'}
            </Link>
          }
          steps={
            requestedId
              ? undefined
              : [
                  `Trigger evaluates on ${automationName}`,
                  'Checks are evaluated',
                  'Vault settles on destination chain',
                ]
          }
        />
      )}

      {rows.length > 0 && !visible.length && <p className="rb-note">No runs match this filter.</p>}

      {!!visible.length && (
        <ul className="rb-feed">
          {visible.map((run) => {
            const tone =
              run.status === 'confirmed'
                ? 'active'
                : run.status === 'failed'
                  ? 'danger'
                  : run.status === 'pending' || run.status === 'in grace period'
                    ? 'paused'
                    : undefined;
            const runMode = networkModeForChain(run.chain);
            const runAutomationChain = automationChainFor(runMode);
            const runDecisionLabel =
              runMode === 'mainnet' ? 'Reactive Mainnet decision' : 'Lasna decision';
            return (
              <li key={`${run.chain}:${run.id}`} className="rb-run" data-tone={tone}>
                <span className="rb-run-marker" aria-hidden="true">
                  <HugeiconsIcon
                    icon={
                      tone === 'active' ? Tick02Icon : tone === 'danger' ? Alert02Icon : Clock01Icon
                    }
                    size={16}
                  />
                </span>
                <div className="rb-run-body">
                  <div className="rb-run-head">
                    <Link className="rb-run-title" to={`/workflows/${run.workflowId}`}>
                      {run.title}
                    </Link>
                    <span className="rb-chip" data-tone={tone}>
                      {run.status}
                    </span>
                  </div>
                  <p className="rb-run-meta">
                    <span>
                      {isFundsChain(run.originChain) && run.originChain !== run.chain
                        ? `${v2Network(run.originChain).name} → ${v2Network(run.chain).name}`
                        : v2Network(run.chain).name}
                    </span>
                    {run.path !== null && <span>Path {run.path + 1}</span>}
                    {run.reason && <span>{run.reason}</span>}
                  </p>
                  <div className="rb-run-links">
                    <TransactionLink
                      chain={run.originChain}
                      hash={run.originTransaction}
                      label="Origin event"
                    />
                    <TransactionLink
                      chain={runAutomationChain}
                      hash={run.lasnaTransaction}
                      label={runDecisionLabel}
                    />
                    <TransactionLink
                      chain={run.chain}
                      hash={run.destinationTransaction}
                      label="Settlement transaction"
                    />
                    <Link to={withNetworkQuery(`${appRoutes.runs}/${run.id}`, runMode)}>
                      Public proof
                    </Link>
                    {!requestedId && (
                      <Link to={`${appRoutes.activity}?workflow=${run.workflowId}&run=${run.id}`}>
                        Run details
                        <HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                  {requestedId && run.path !== null && (
                    <div className="rb-run-path">
                      <RunPath run={run} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {query.hasNextPage && (
        <button
          type="button"
          className="app-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage && <Spinner />}
          {query.isFetchingNextPage ? 'Loading more runs' : 'Load more runs'}
        </button>
      )}
      <V2Feedback wallet={wallet} />
    </section>
  );
}

function RunPath({ run }: { run: z.infer<typeof runSchema> }) {
  const automationChain = automationChainFor(networkModeForChain(run.chain));
  const query = useQuery({
    queryKey: ['workflow-v2', 'proof-program', automationChain, run.agent, run.programHash],
    queryFn: async () => {
      const encoded = await workflowClient(automationChain).readContract({
        address: run.agent,
        abi: workflowAgentV2Abi,
        functionName: 'programs',
        args: [run.programHash],
      });
      return decodeWorkflowV2(encoded);
    },
  });
  if (query.error) return <p role="alert">The historical workflow path could not be read.</p>;
  if (!query.data) return <Spinner label="Reading the workflow version…" />;
  return (
    <WorkflowCanvas
      draft={diagramV2(toDraft(query.data, run.title)).canvas}
      leaf={canvasLeaf(query.data, run.path)}
    />
  );
}

type FundsOperation =
  | 'add-usdc'
  | 'add-weth'
  | 'withdraw-usdc'
  | 'withdraw-weth'
  | 'run-credit'
  | 'watch-credit'
  | 'approve-refill-usdc'
  | 'revoke-refill-usdc'
  | 'withdraw-eth'
  | 'withdraw-agent-eth';

type FundingGroup =
  'Vault funds' | 'Execution credit' | 'Watching credit' | 'Allowances' | 'Recovery';

type FundingKind =
  | 'deposit'
  | 'withdraw'
  | 'execution-credit'
  | 'watching-credit'
  | 'allowance'
  | 'revoke-allowance'
  | 'agent-withdraw';

type FundingUnit = 'USDC' | 'WETH' | 'ETH' | 'lREACT' | 'REACT';

type FundingBalanceKey =
  | 'stable'
  | 'wrapped'
  | 'native'
  | 'agentNative'
  | 'walletStable'
  | 'walletWrapped'
  | 'walletNative'
  | 'walletWatch';

interface FundingAction {
  readonly label: string;
  readonly group: FundingGroup;
  readonly kind: FundingKind;
  readonly unit: FundingUnit;
  readonly decimals: number;
  readonly amountLabel: string;
  readonly requiresAmount: boolean;
  readonly hint: string;
  readonly balanceKey?: FundingBalanceKey;
  readonly balanceLabel?: 'Wallet balance' | 'Vault balance' | 'Agent balance';
  readonly validateBalance?: boolean;
}

const fundingGroupOrder: readonly FundingGroup[] = [
  'Vault funds',
  'Execution credit',
  'Watching credit',
  'Allowances',
  'Recovery',
];

function fundingActionsFor(mode: NetworkMode): Record<FundsOperation, FundingAction> {
  const autoChain = getChain(automationChainFor(mode));
  const watchSymbol: 'lREACT' | 'REACT' = autoChain.nativeSymbol === 'REACT' ? 'REACT' : 'lREACT';
  const assetPrefix = mode === 'mainnet' ? '' : 'test ';
  return {
    'add-usdc': {
      label: 'Deposit USDC',
      group: 'Vault funds',
      kind: 'deposit',
      unit: 'USDC',
      decimals: 6,
      amountLabel: 'Amount (USDC)',
      requiresAmount: true,
      hint: `Sends ${assetPrefix}USDC to the vault. USDC pays for buys, transfers, and balance refills.`,
      balanceKey: 'walletStable',
      balanceLabel: 'Wallet balance',
      validateBalance: true,
    },
    'add-weth': {
      label: 'Deposit WETH',
      group: 'Vault funds',
      kind: 'deposit',
      unit: 'WETH',
      decimals: 18,
      amountLabel: 'Amount (WETH)',
      requiresAmount: true,
      hint: `Sends ${assetPrefix}WETH to the vault. Only needed for workflows that sell WETH.`,
      balanceKey: 'walletWrapped',
      balanceLabel: 'Wallet balance',
      validateBalance: true,
    },
    'withdraw-usdc': {
      label: 'Withdraw USDC',
      group: 'Vault funds',
      kind: 'withdraw',
      unit: 'USDC',
      decimals: 6,
      amountLabel: 'Amount (USDC)',
      requiresAmount: true,
      hint: 'Returns USDC from the vault to your wallet.',
      balanceKey: 'stable',
      balanceLabel: 'Vault balance',
      validateBalance: true,
    },
    'withdraw-weth': {
      label: 'Withdraw WETH',
      group: 'Vault funds',
      kind: 'withdraw',
      unit: 'WETH',
      decimals: 18,
      amountLabel: 'Amount (WETH)',
      requiresAmount: true,
      hint: 'Returns WETH from the vault to your wallet.',
      balanceKey: 'wrapped',
      balanceLabel: 'Vault balance',
      validateBalance: true,
    },
    'run-credit': {
      label: 'Deposit ETH for execution credit',
      group: 'Execution credit',
      kind: 'execution-credit',
      unit: 'ETH',
      decimals: 18,
      amountLabel: 'Amount (ETH)',
      requiresAmount: true,
      hint: `Sends ${assetPrefix}ETH to the settlement callback proxy for this vault. This credit pays workflow callbacks; it is not held in the vault.`,
      balanceKey: 'walletNative',
      balanceLabel: 'Wallet balance',
      validateBalance: true,
    },
    'watch-credit': {
      label: `Deposit ${watchSymbol} for watching credit`,
      group: 'Watching credit',
      kind: 'watching-credit',
      unit: watchSymbol,
      decimals: 18,
      amountLabel: `Amount (${watchSymbol})`,
      requiresAmount: true,
      hint: `Sends ${assetPrefix}${watchSymbol} to ${autoChain.name} for this agent. Watching credit pays for trigger evaluations.`,
      balanceKey: 'walletWatch',
      balanceLabel: 'Wallet balance',
      validateBalance: true,
    },
    'approve-refill-usdc': {
      label: 'Set USDC refill allowance',
      group: 'Allowances',
      kind: 'allowance',
      unit: 'USDC',
      decimals: 6,
      amountLabel: 'Allowance (USDC)',
      requiresAmount: true,
      hint: 'Lets the vault pull USDC from your wallet for balance refills, up to this total allowance.',
      balanceKey: 'walletStable',
      balanceLabel: 'Wallet balance',
    },
    'revoke-refill-usdc': {
      label: 'Revoke USDC refill allowance',
      group: 'Allowances',
      kind: 'revoke-allowance',
      unit: 'USDC',
      decimals: 6,
      amountLabel: 'Amount',
      requiresAmount: false,
      hint: 'Stops the vault from pulling any more USDC from your wallet.',
    },
    'withdraw-eth': {
      label: 'Recover unused vault ETH',
      group: 'Recovery',
      kind: 'withdraw',
      unit: 'ETH',
      decimals: 18,
      amountLabel: 'Amount (ETH)',
      requiresAmount: true,
      hint: 'Returns ETH that was sent directly to the vault contract. This balance is separate from execution credit.',
      balanceKey: 'native',
      balanceLabel: 'Vault balance',
      validateBalance: true,
    },
    'withdraw-agent-eth': {
      label: `Recover unused agent ${watchSymbol}`,
      group: 'Recovery',
      kind: 'agent-withdraw',
      unit: watchSymbol,
      decimals: 18,
      amountLabel: `Amount (${watchSymbol})`,
      requiresAmount: true,
      hint: `Returns ${watchSymbol} that was sent directly to the Agent on ${autoChain.name}. This balance is separate from watching credit.`,
      balanceKey: 'agentNative',
      balanceLabel: 'Agent balance',
      validateBalance: true,
    },
  };
}

function displayUnits(value: bigint, decimals: number) {
  const [whole, fraction] = formatUnits(value, decimals).split('.');
  const trimmed = fraction?.slice(0, 4).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function exactUnits(value: bigint, decimals: number) {
  const [whole = '0', fraction] = formatUnits(value, decimals).split('.');
  if (!fraction) return whole;
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

async function findLinkedWorkflowChain(owner: Address, mode: NetworkMode = 'testnet') {
  const agent = await readAgent(owner, undefined, mode);
  if (agent === zeroAddress) return null;
  const autoChain = automationChainFor(mode);
  let lastError: unknown;
  let checkedAny = false;
  for (const chain of configuredFundsChains(mode)) {
    try {
      const vault = await readVault(owner, chain);
      checkedAny = true;
      if (vault === zeroAddress) continue;
      const [linkedVault, linkedAgent] = await Promise.all([
        workflowClient(autoChain).readContract({
          address: agent,
          abi: workflowAgentV2Abi,
          functionName: 'vaults',
          args: [chain],
        }),
        workflowClient(chain).readContract({
          address: vault,
          abi: workflowVaultV2Abi,
          functionName: 'agent',
        }),
      ]);
      if (isAddressEqual(linkedVault, vault) && isAddressEqual(linkedAgent, agent)) {
        return { agent, vault, chain };
      }
    } catch (cause) {
      lastError = cause;
    }
  }
  if (!checkedAny && lastError) throw lastError;
  return null;
}

export function WorkflowAccountRouteV2({ startWorkflow = false }: { startWorkflow?: boolean }) {
  const { setupWalletForChain, fundingWalletForChain } = useWorkflowV2Wallet();
  const { mode, isMainnet, defaultFundsChainId, deployment } = useNetworkMode();
  const [params] = useSearchParams();
  const credit = params.get('credit');
  const funding = credit === 'watching' || credit === 'execution' ? credit : undefined;
  const parsedChain = fundsChainIdSchema.safeParse(Number(params.get('chain')));
  const initialChain =
    parsedChain.success && configuredFundsChains(mode).includes(parsedChain.data)
      ? parsedChain.data
      : undefined;
  const chains = configuredFundsChains(mode);
  const [selectedSetup, setSelectedSetup] = useState<{
    readonly mode: NetworkMode;
    readonly initialChain: SettlementChain | undefined;
    readonly chain: SettlementChain;
  }>();
  const setupChain =
    selectedSetup?.mode === mode &&
    selectedSetup.initialChain === initialChain &&
    chains.includes(selectedSetup.chain)
      ? selectedSetup.chain
      : (initialChain ?? defaultFundsChainId);
  const builder = <Navigate to={appRoutes.newWorkflow} replace />;
  const accountFor = (chain: SettlementChain) => (
    <AppShell>
      <WorkflowAccountV2
        key={`${mode}:${funding ?? 'default'}:${initialChain ?? chain}`}
        funding={funding}
        initialChain={initialChain ?? chain}
      />
    </AppShell>
  );
  if (!deployment) {
    if (startWorkflow) {
      return isMainnet ? (
        <AppShell>
          <MainnetUnavailableCallout context="Account & Vault" />
        </AppShell>
      ) : (
        builder
      );
    }
    return accountFor(setupChain);
  }
  if (startWorkflow && !workflowActivationEnabled) return builder;

  return (
    <WalletAccountSetupGate
      title="Account & Vault"
      chainId={setupChain}
      availableChains={chains}
      onChainChange={(nextChain) => setSelectedSetup({ mode, initialChain, chain: nextChain })}
      findLinkedChain={(owner) => findLinkedWorkflowChain(owner, mode)}
      wallet={setupWalletForChain(setupChain)}
      fundingWallet={fundingWalletForChain(setupChain)}
      startWorkflow={startWorkflow}
      workflowScope={`workflow-v2:${mode}:${deployment.automationFactory}:${deployment.unichain.factory}${deployment.base ? `:${deployment.base.factory}` : ''}`}
    >
      {({ chain }) => (startWorkflow ? builder : accountFor(chain))}
    </WalletAccountSetupGate>
  );
}

export function WorkflowAccountV2({
  manage = false,
  funding,
  initialChain,
}: {
  manage?: boolean;
  funding?: 'watching' | 'execution';
  initialChain?: SettlementChain;
}) {
  const wallet = useWorkflowV2Wallet();
  const {
    mode,
    isMainnet,
    automationChainId,
    automationName,
    nativeSymbol,
    defaultFundsChainId,
    isDeploymentConfigured,
  } = useNetworkMode();
  const [params] = useSearchParams();
  const parsedParamChain = fundsChainIdSchema.safeParse(Number(params.get('chain')));
  const requestedChain =
    initialChain ?? (parsedParamChain.success ? parsedParamChain.data : undefined);
  const chains = configuredFundsChains(mode);
  const [selectedChain, setSelectedChain] = useState<{
    readonly mode: NetworkMode;
    readonly requestedChain: SettlementChain | undefined;
    readonly chain: SettlementChain;
  }>();
  const chain =
    selectedChain?.mode === mode &&
    selectedChain.requestedChain === requestedChain &&
    chains.includes(selectedChain.chain)
      ? selectedChain.chain
      : requestedChain && chains.includes(requestedChain)
        ? requestedChain
        : defaultFundsChainId;
  const [operation, setOperation] = useState<FundsOperation>(
    funding === 'watching' ? 'watch-credit' : funding === 'execution' ? 'run-credit' : 'add-usdc',
  );
  const [amount, setAmount] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const factoryAvailable = isDeploymentConfigured && Boolean(settlementFactory(chain));
  const data = useQuery({
    queryKey: ['workflow-v2', 'funding', mode, wallet.owner, chain],
    enabled: Boolean(wallet.owner && factoryAvailable),
    queryFn: () => readFundsV2(wallet.owner!, chain),
    refetchInterval: 12_000,
  });
  const funds = data.data;
  const vaultReady = !!funds && funds.vault !== zeroAddress;
  useEffect(() => {
    if (funding && vaultReady) amountRef.current?.focus();
  }, [funding, vaultReady]);
  const fundingActions = fundingActionsFor(mode);
  const showVaultRecovery = Boolean(funds && funds.native > 0n);
  const showAgentRecovery = Boolean(funds && funds.agentNative > 0n);
  const available = (key: FundsOperation) =>
    (key !== 'withdraw-eth' || showVaultRecovery) &&
    (key !== 'withdraw-agent-eth' || showAgentRecovery);
  const groups = fundingGroupOrder
    .map((group) => ({
      group,
      actions: (Object.keys(fundingActions) as FundsOperation[]).filter(
        (key) => fundingActions[key].group === group && available(key),
      ),
    }))
    .filter((entry) => entry.actions.length > 0);
  const activeOperation = available(operation) ? operation : 'add-usdc';
  const action = fundingActions[activeOperation];
  const balance = action.balanceKey && funds ? funds[action.balanceKey] : undefined;
  const limit = action.validateBalance ? balance : undefined;

  let amountError: string | undefined;
  let parsedAmount: bigint | undefined;
  if (action.requiresAmount && amount.trim()) {
    try {
      parsedAmount = readAmount(amount, action.decimals, 'amount');
      if (parsedAmount === 0n) amountError = 'Enter a positive amount.';
      else if (limit !== undefined && parsedAmount > limit)
        amountError = `You can use at most ${exactUnits(limit, action.decimals)} ${action.unit}.`;
    } catch (error) {
      amountError = error instanceof Error ? error.message : 'Enter a valid amount.';
    }
  }
  const canSubmit =
    !wallet.busy &&
    (!action.requiresAmount || (parsedAmount !== undefined && parsedAmount > 0n)) &&
    !amountError;

  function submit() {
    void wallet.perform(async () => {
      if (!funds || funds.vault === zeroAddress)
        throw new Error('Create your Agent and Vault first.');
      const quantity = action.requiresAmount
        ? readAmount(amount, action.decimals, 'funding amount')
        : 0n;
      if (action.requiresAmount && quantity === 0n) throw new Error('Enter a positive amount.');
      if (action.validateBalance && action.balanceKey) {
        const limit = funds[action.balanceKey];
        if (quantity > limit)
          throw new Error(
            `You can use at most ${exactUnits(limit, action.decimals)} ${action.unit}.`,
          );
      }
      const display = `${formatUnits(quantity, action.decimals)} ${action.unit}`;
      if (action.kind === 'allowance' || action.kind === 'revoke-allowance') {
        await wallet.send(
          chain,
          funds.usdc,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [funds.vault, quantity],
          }),
          action.hint,
          display,
        );
      } else if (action.kind === 'execution-credit' || action.kind === 'watching-credit') {
        const watching = action.kind === 'watching-credit';
        const provider = watching ? funds.lasnaSystem : funds.proxy;
        if (!provider || provider === zeroAddress)
          throw new Error('Network credit is unavailable for this network.');
        await wallet.send(
          watching ? automationChainId : chain,
          provider,
          encodeFunctionData({
            abi: executionCreditAbi,
            functionName: 'depositTo',
            args: [watching ? funds.agent : funds.vault],
          }),
          action.hint,
          display,
          quantity,
        );
      } else if (action.kind === 'deposit') {
        const token: Address = action.unit === 'USDC' ? funds.usdc : funds.weth;
        if (token === zeroAddress)
          throw new Error(
            isMainnet ? 'This token is unavailable.' : 'This testnet token is unavailable.',
          );
        await wallet.send(
          chain,
          token,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [funds.vault, quantity],
          }),
          action.hint,
          display,
        );
      } else if (action.kind === 'agent-withdraw') {
        if (funds.agent === zeroAddress) throw new Error('Create your Agent first.');
        await wallet.send(
          automationChainId,
          funds.agent,
          encodeFunctionData({
            abi: workflowAgentV2Abi,
            functionName: 'withdraw',
            args: [quantity],
          }),
          action.hint,
          display,
        );
      } else {
        const token: Address =
          action.unit === 'USDC' ? funds.usdc : action.unit === 'WETH' ? funds.weth : zeroAddress;
        if (action.unit !== 'ETH' && token === zeroAddress)
          throw new Error(
            isMainnet ? 'This token is unavailable.' : 'This testnet token is unavailable.',
          );
        await wallet.send(
          chain,
          funds.vault,
          encodeFunctionData({
            abi: workflowVaultV2Abi,
            functionName: 'withdraw',
            args: [token, quantity],
          }),
          action.hint,
          display,
        );
      }
      setAmount('');
    });
  }

  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Manage"
        title="Account & Vault"
        description={
          isMainnet
            ? 'Track balances, watching credit, and execution credit from one place.'
            : 'Track testnet balances, watching credit, and execution credit from one place.'
        }
        aside={
          <div className="rb-inline">
            {chains.length > 1 ? (
              <Select
                value={String(chain)}
                aria-label="Vault network"
                groups={[
                  {
                    label: 'Vault network',
                    options: chains.map((id) => ({
                      value: String(id),
                      label: v2Network(id).name,
                    })),
                  },
                ]}
                onChange={(nextValue) => {
                  const parsed = fundsChainIdSchema.safeParse(Number(nextValue));
                  if (parsed.success) {
                    setSelectedChain({ mode, requestedChain, chain: parsed.data });
                    setAmount('');
                  }
                }}
              />
            ) : (
              <span className="rb-chip rb-chip--plain">{v2Network(chain).name}</span>
            )}
            {manage && (
              <Link
                to={withNetworkQuery(
                  chain === defaultFundsChainId
                    ? appRoutes.account
                    : `${appRoutes.account}?chain=${chain}`,
                  mode,
                )}
                className="app-button"
              >
                Back to account
              </Link>
            )}
          </div>
        }
      />

      {!wallet.owner && (
        <Callout title="Connect a wallet to open its account" action={<WalletControl setup />}>
          <p>Balances and credit are read from the agent and vault owned by that wallet.</p>
        </Callout>
      )}

      {!wallet.owner && (
        <HowItWorks
          title="What your account holds"
          steps={[
            {
              icon: Coins01Icon,
              title: 'Vault funds',
              copy: `USDC and WETH principal held by the vault on ${v2Network(chain).name}.`,
            },
            {
              icon: Pulse01Icon,
              title: 'Watching credit',
              copy: `${nativeSymbol} that pays the agent to monitor triggers on ${automationName}.`,
            },
            {
              icon: Shield01Icon,
              title: 'Execution credit',
              copy: 'ETH held by the callback proxy to pay for the callbacks that settle runs.',
            },
          ]}
        />
      )}

      {!isDeploymentConfigured && isMainnet ? (
        <MainnetUnavailableCallout context="Account & Vault" />
      ) : (
        !settlementFactory(chain) && (
          <p className="rb-note">
            <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
            The V2 Vault factory is unavailable on {v2Network(chain).name}.
          </p>
        )
      )}

      {data.error && (
        <div className="rb-alert" role="alert">
          <span>{data.error.message}</span>
        </div>
      )}

      {!!wallet.owner && factoryAvailable && data.isPending && (
        <LoadingRegion
          label={isMainnet ? 'Reading your account…' : 'Reading your testnet account…'}
          className="rb-page-skeleton"
        >
          <div className="rb-balance-grid" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div className="rb-balance" key={index}>
                <Skeleton className="rb-skeleton--line rb-skeleton--short" />
                <Skeleton className="rb-skeleton--balance" />
                <Skeleton className="rb-skeleton--line" />
              </div>
            ))}
          </div>
          <div className="rb-split" aria-hidden="true">
            <Skeleton className="rb-skeleton--panel" />
            <Skeleton className="rb-skeleton--panel" />
          </div>
        </LoadingRegion>
      )}

      {funds &&
        funds.vault === zeroAddress &&
        (manage ? (
          <p className="rb-note">This wallet has no vault. Create one through account setup.</p>
        ) : (
          <Callout
            title={`No ${v2Network(chain).name} Vault yet`}
            action={
              <Button
                variant="primary"
                disabled={wallet.busy}
                onClick={() => void wallet.ensureVault(chain)}
              >
                {wallet.busy ? 'Setting up Vault…' : `Create & link ${v2Network(chain).name} Vault`}
              </Button>
            }
          >
            <p>
              Deploy a settlement Vault on {v2Network(chain).name} and link it to your{' '}
              {automationName} Agent so workflows can settle on {v2Network(chain).name}.
            </p>
          </Callout>
        ))}
      {funds && funds.vault !== zeroAddress && (
        <>
          <WorkflowCreditNotice owner={wallet.owner} chain={chain} />
          <div className="rb-balance-grid">
            <div className="rb-balance" data-role="funds">
              <p className="rb-balance-head">
                <HugeiconsIcon icon={Coins01Icon} size={13} aria-hidden="true" />
                Vault USDC
              </p>
              <p className="rb-balance-value">
                {displayUnits(funds.stable, 6)}
                <span>USDC</span>
              </p>
              <p className="rb-balance-foot">Principal for buys, transfers, and refills</p>
            </div>
            <div className="rb-balance" data-role="funds">
              <p className="rb-balance-head">
                <HugeiconsIcon icon={Coins01Icon} size={13} aria-hidden="true" />
                Vault WETH
              </p>
              <p className="rb-balance-value">
                {displayUnits(funds.wrapped, 18)}
                <span>WETH</span>
              </p>
              <p className="rb-balance-foot">Principal for workflows that sell WETH</p>
            </div>
            <div className="rb-balance" data-role="credit">
              <p className="rb-balance-head">
                <HugeiconsIcon icon={Pulse01Icon} size={13} aria-hidden="true" />
                Execution credit
              </p>
              <p className="rb-balance-value">
                {displayUnits(funds.execution, 18)}
                <span>ETH</span>
              </p>
              <p className="rb-balance-foot">Pays callback gas on {v2Network(chain).name}</p>
            </div>
          </div>

          {funds.native > 0n && (
            <Callout
              tone="recovery"
              title="Unused vault ETH"
              action={
                <Button
                  onClick={() => {
                    setOperation('withdraw-eth');
                    setAmount(exactUnits(funds.native, 18));
                    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    amountRef.current?.focus({ preventScroll: true });
                  }}
                >
                  Recover ETH
                </Button>
              }
            >
              <p>
                {exactUnits(funds.native, 18)} ETH sits in the vault contract. It is separate from
                execution credit and does not pay for callbacks.
              </p>
            </Callout>
          )}

          {funds.agentNative > 0n && (
            <Callout
              tone="recovery"
              title={`Unused agent ${nativeSymbol}`}
              action={
                <Button
                  onClick={() => {
                    setOperation('withdraw-agent-eth');
                    setAmount(exactUnits(funds.agentNative, 18));
                    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    amountRef.current?.focus({ preventScroll: true });
                  }}
                >
                  Recover {nativeSymbol}
                </Button>
              }
            >
              <p>
                {exactUnits(funds.agentNative, 18)} {nativeSymbol} sits in the Agent contract on{' '}
                {automationName}. It is separate from watching credit and does not pay for trigger
                evaluations.
              </p>
            </Callout>
          )}

          <div className="rb-split">
            <div className="app-panel">
              <div className="rb-panel-head">
                <div>
                  <h2 className="rb-panel-title">{isMainnet ? 'Move funds' : 'Move test funds'}</h2>
                  <p className="rb-panel-copy">
                    Every action sends one transaction from your wallet.
                  </p>
                </div>
              </div>
              <form
                ref={formRef}
                className="rb-panel-body"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <div
                  className={
                    action.requiresAmount ? 'rb-form-grid' : 'rb-form-grid rb-form-grid--two'
                  }
                >
                  <V2Field name="Funding action">
                    <Select
                      value={activeOperation}
                      aria-describedby="funding-hint"
                      onChange={(next) => {
                        setOperation(next);
                        setAmount('');
                      }}
                      groups={groups.map(({ group, actions }) => ({
                        label: group,
                        options: actions.map((key) => ({
                          value: key,
                          label: fundingActions[key].label,
                        })),
                      }))}
                    />
                  </V2Field>
                  {action.requiresAmount && (
                    <V2Field name={action.amountLabel}>
                      <input
                        ref={amountRef}
                        className="app-input"
                        inputMode="decimal"
                        value={amount}
                        placeholder="0.00"
                        aria-invalid={amountError ? true : undefined}
                        aria-describedby="funding-hint"
                        onChange={(event) => setAmount(event.target.value)}
                      />
                    </V2Field>
                  )}
                  <button
                    className="app-button app-button--primary"
                    disabled={!canSubmit}
                    type="submit"
                  >
                    Review transaction
                  </button>
                </div>
                <div className="rb-funding-guidance">
                  <p
                    id="funding-hint"
                    className="rb-funding-hint"
                    data-tone={amountError ? 'error' : undefined}
                    role={amountError ? 'alert' : undefined}
                  >
                    {amountError ?? action.hint}
                  </p>
                  {action.requiresAmount && balance !== undefined && (
                    <p className="rb-funding-hint">
                      {action.balanceLabel}:{' '}
                      <strong>
                        {exactUnits(balance, action.decimals)} {action.unit}
                      </strong>
                      {action.balanceKey === 'walletNative' || action.balanceKey === 'walletWatch'
                        ? ' Keep a little for network gas.'
                        : null}
                    </p>
                  )}
                </div>
              </form>
            </div>

            <div className="app-panel">
              <div className="rb-panel-head">
                <div>
                  <h2 className="rb-panel-title">Credits and allowances</h2>
                  <p className="rb-panel-copy">
                    Watching credit funds {automationName} evaluations. The allowance caps USDC
                    refills.
                  </p>
                </div>
              </div>
              <div className="rb-panel-body">
                <div className="rb-credit-list">
                  <div className="rb-credit-row">
                    <span className="rb-credit-name">Watching credit</span>
                    <span className="rb-credit-value">
                      {displayUnits(funds.watch, 18)}
                      <span>{nativeSymbol}</span>
                    </span>
                  </div>
                  <div className="rb-credit-row">
                    <span className="rb-credit-name">USDC refill allowance</span>
                    <span className="rb-credit-value">
                      {displayUnits(funds.refillAllowance, 6)}
                      <span>USDC</span>
                    </span>
                  </div>
                </div>
                <p className="rb-credit-note">
                  Watching credit is held on {automationName} and execution credit on the{' '}
                  {v2Network(chain).name} callback proxy. Both are prepaid to the network and
                  consumed as fees; the network exposes no withdrawal for unspent credit. The refill
                  allowance is approved on {v2Network(chain).name}.
                </p>
              </div>
            </div>
          </div>

          {wallet.owner && funds.agent !== zeroAddress && (
            <TelegramNotifications workflow agent={funds.agent} owner={wallet.owner} />
          )}

          <div className="app-panel">
            <div className="rb-panel-head">
              <div>
                <h2 className="rb-panel-title">Contracts</h2>
                <p className="rb-panel-copy">The agent and vault owned by this wallet.</p>
              </div>
            </div>
            <div className="rb-panel-body">
              <div className="rb-address-list">
                <div className="rb-address-row">
                  <div className="rb-address-copy">
                    <span className="rb-address-name">{automationName} Agent</span>
                    <span className="rb-address-value">{funds.agent}</span>
                  </div>
                  <CopyButton value={funds.agent} label="agent address" />
                </div>
                <div className="rb-address-row">
                  <div className="rb-address-copy">
                    <span className="rb-address-name">{v2Network(chain).name} Vault</span>
                    <span className="rb-address-value">{funds.vault}</span>
                  </div>
                  <CopyButton value={funds.vault} label="vault address" />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      <V2Feedback wallet={wallet} />
    </section>
  );
}
