import {
  decodeWorkflowV2,
  executionCreditAbi,
  LASNA_CHAIN_ID,
  readAmount,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowIdSchema,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowVaultV2Abi,
  workflowV2Action,
} from '@rulebook/shared';
import {
  Add01Icon,
  Alert02Icon,
  ArrowRight01Icon,
  Book02Icon,
  Clock01Icon,
  Coins01Icon,
  InformationCircleIcon,
  Pulse01Icon,
  RefreshIcon,
  Shield01Icon,
  Tick02Icon,
  TradeUpIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { z } from 'zod';

import { PageHeading } from '@/components/chrome/PageHeading';
import { WalletControl } from '@/components/chrome/WalletControl';
import { CopyButton } from '@/components/chrome/CopyButton';
import { EmptyState } from '@/components/chrome/EmptyState';
import { HowItWorks } from '@/components/chrome/HowItWorks';
import { NetworkBadge } from '@/components/NetworkBadge';
import { V2Feedback, V2Field, WorkflowProgramSummary } from './BuilderV2';
import {
  readFundsV2,
  readWorkflowsV2,
  readWorkflowV2,
  settlementFactory,
  useWorkflowV2Wallet,
  v2Explorer,
  v2Network,
  workflowV2Deployment,
  workflowClient,
} from './chainV2';
import { toDraft } from './modelV2';
import { WorkflowCanvas } from './Graph';
import { canvasLeaf, diagramV2 } from './diagramV2';
import { v2ApiBase } from './listingV2';

export function WorkflowsV2() {
  const { owner } = useWorkflowV2Wallet();
  const rows = useQuery({
    queryKey: ['workflow-v2', 'workflows', owner],
    enabled: Boolean(owner && workflowV2Deployment),
    queryFn: () => readWorkflowsV2(owner!),
    refetchInterval: 12_000,
  });
  const workflows = rows.data ?? [];
  const watching = workflows.filter((row) => row.active).length;
  const awaiting = workflows.filter((row) => !row.active && row.staged && row.auth[3]).length;
  const paused = workflows.length - watching - awaiting;

  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Automation"
        title="Workflows"
        description="Build, activate, and monitor the testnet automations that run from your wallet."
        aside={
          <Link className="app-button app-button--primary" to="/workflows/new">
            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
            New workflow
          </Link>
        }
      />

      {!owner && (
        <div className="rb-callout">
          <div className="rb-callout-copy">
            <p className="rb-callout-title">Connect a wallet to load your workflows</p>
            <p>Your agent, vault, and run history all belong to the connected wallet.</p>
          </div>
          <WalletControl setup />
        </div>
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
              copy: 'Your vault executes the swap, transfer, or alert on Unichain Sepolia.',
            },
          ]}
        />
      )}

      {!workflowV2Deployment && (
        <p className="rb-note">
          <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
          Testnet activation is being configured. You can still browse recipes and build a draft.
        </p>
      )}

      {rows.error && (
        <div className="rb-alert" role="alert">
          <span>{rows.error.message}</span>
          <button type="button" onClick={() => void rows.refetch()}>
            Try again
          </button>
        </div>
      )}

      {!!owner && !!rows.data && (
        <div className="rb-metrics">
          <div className="rb-metric">
            <p className="rb-metric-label">Workflows</p>
            <p className="rb-metric-value">{workflows.length}</p>
            <p className="rb-metric-note">Saved in this vault</p>
          </div>
          <div className="rb-metric" data-tone="active">
            <p className="rb-metric-label">Watching</p>
            <p className="rb-metric-value">{watching}</p>
            <p className="rb-metric-note">Evaluating triggers on Lasna</p>
          </div>
          <div className="rb-metric">
            <p className="rb-metric-label">Needs attention</p>
            <p className="rb-metric-value">{awaiting + paused}</p>
            <p className="rb-metric-note">Paused or awaiting activation</p>
          </div>
        </div>
      )}

      {!!owner && Boolean(workflowV2Deployment) && rows.isPending && (
        <div className="rb-skeleton-grid" aria-hidden="true">
          <div className="rb-skeleton rb-skeleton--tall" />
          <div className="rb-skeleton rb-skeleton--tall" />
        </div>
      )}
      {!!owner && Boolean(workflowV2Deployment) && rows.isFetching && !rows.data && (
        <span className="sr-only" role="status">
          Reading your workflows…
        </span>
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
            const ready = !row.active && row.staged && row.auth[3];
            const tone = row.active ? 'active' : ready ? 'info' : 'paused';
            const label = row.active ? 'Watching' : ready ? 'Ready to activate' : 'Paused';
            return (
              <li key={row.id}>
                <Link to={`/workflows/${row.id}`} className="rb-card">
                  <div className="rb-card-body">
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
                      <span className="rb-chip" data-tone={tone}>
                        {label}
                      </span>
                    </div>
                  </div>
                  <div className="rb-card-foot">
                    <span>
                      {row.active
                        ? 'Watching for events'
                        : ready
                          ? 'Authorization pending'
                          : 'Not watching'}
                    </span>
                    <span className="rb-card-cue">
                      Open
                      <HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function WorkflowDetailV2() {
  const { id: raw } = useParams();
  const id = workflowIdSchema.safeParse(raw);
  const wallet = useWorkflowV2Wallet();
  const data = useQuery({
    queryKey: ['workflow-v2', 'detail', wallet.owner, raw],
    enabled: Boolean(wallet.owner && id.success),
    queryFn: () => readWorkflowV2(wallet.owner!, id.data!),
    refetchInterval: 12_000,
  });
  if (!id.success) return <p role="alert">This workflow link is invalid.</p>;
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
  if (!data.data) return <p role="status">Reading your workflow…</p>;
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
              data-tone={item.closed || active ? 'active' : item.auth[3] ? 'info' : 'paused'}
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
        {(item.auth[3] || item.entry[4] !== 0) && (
          <button
            type="button"
            className="app-button"
            disabled={wallet.busy}
            onClick={() => void wallet.pause(item)}
          >
            Pause workflow
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
        <Link to="/activity" className="app-button">
          Activity
        </Link>
      </div>
      <div className="rb-canvas-panel">
        <WorkflowCanvas draft={diagramV2(toDraft(program, item.title)).canvas} />
        <div className="rb-panel-body">
          <WorkflowProgramSummary draft={toDraft(program, item.title)} />
        </div>
      </div>
      {!item.staged && <Publication item={item} wallet={wallet} />}
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
  const [description, setDescription] = useState('');
  const factory = workflowV2Deployment?.lasna.factory;
  const reader = workflowClient(LASNA_CHAIN_ID);
  const listing = useQuery({
    queryKey: ['workflow-v2', 'publication', item.id, item.entry[0]],
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
  return (
    <section
      className="app-panel app-panel-pad workflow-v2-stack"
      aria-label="Marketplace publication"
    >
      <h2 className="app-panel-heading">Marketplace</h2>
      {listing.error && (
        <p role="alert" className="workflow-error">
          {listing.error.message}
        </p>
      )}
      {published?.visible ? (
        <div className="workflow-actions">
          <Link className="app-link" to={`/marketplace/${published.id}`}>
            View listing
          </Link>
          <button
            type="button"
            className="app-button"
            disabled={wallet.busy}
            onClick={() =>
              void wallet.perform(async () => {
                await wallet.send(
                  LASNA_CHAIN_ID,
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
        </div>
      ) : (
        <form
          className="workflow-v2-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void wallet.perform(async () => {
              const text = description.trim();
              if (!text || new TextEncoder().encode(text).length > 280)
                throw new Error('Enter a description of up to 280 bytes.');
              await wallet.send(
                LASNA_CHAIN_ID,
                factory,
                encodeFunctionData({
                  abi: workflowAgentFactoryV2Abi,
                  functionName: 'publish',
                  args: [item.id, text],
                }),
                'Publish this workflow version in the testnet Marketplace.',
              );
              setDescription('');
            });
          }}
        >
          <V2Field name="Public description">
            <textarea
              className="app-input"
              maxLength={280}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </V2Field>
          <button
            className="app-button"
            type="submit"
            disabled={wallet.busy || listing.isPending || !description.trim()}
          >
            Publish version
          </button>
        </form>
      )}
    </section>
  );
}

const settlementChainSchema = z.literal(UNICHAIN_SEPOLIA_CHAIN_ID);
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
  status: z.enum(['pending', 'confirmed', 'skipped', 'expired', 'failed', 'in grace period']),
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
  const { id: requestedId } = useParams();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const requested = workflowIdSchema.safeParse(requestedId);
  const query = useInfiniteQuery({
    queryKey: ['workflow-v2', 'activity', wallet.owner, requestedId],
    enabled: Boolean(wallet.owner && workflowV2Deployment && (!requestedId || requested.success)),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        owner: wallet.owner!,
        ...(requested.data ? { id: requested.data } : {}),
        ...(pageParam ? { after: pageParam } : {}),
      });
      const response = await fetch(`${v2ApiBase}/v3/activity?${params}`, { signal });
      if (!response.ok) throw new Error('Couldn’t read workflow activity.');
      return activityPage.parse(await response.json());
    },
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (state) => ((state.state.data?.pages.length ?? 0) <= 1 ? 12_000 : false),
  });
  if (requestedId && !requested.success) return <p role="alert">This run link is invalid.</p>;
  const rows = query.data?.pages.flatMap((page) => page.runs) ?? [];
  const visible =
    filter === 'all' ? rows : rows.filter((run) => activityFilterStatuses[filter].has(run.status));
  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Automation"
        title="Activity"
        description="Follow each run from the origin event through the Lasna decision to settlement."
        aside={
          <>
            {wallet.owner && <span className="rb-chip rb-chip--plain">{rows.length} loaded</span>}
            <button
              type="button"
              className="app-button"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <HugeiconsIcon icon={RefreshIcon} size={15} aria-hidden="true" />
              Refresh
            </button>
          </>
        }
      />

      {!wallet.owner && (
        <div className="rb-callout">
          <div className="rb-callout-copy">
            <p className="rb-callout-title">Connect a wallet to read its runs</p>
            <p>Activity is scoped to the wallet that owns the agent and vault.</p>
          </div>
          <WalletControl setup />
        </div>
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
              title: 'Lasna decision',
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

      {!workflowV2Deployment && (
        <p className="rb-note">
          <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
          Activity opens when the V2 testnet deployment is configured.
        </p>
      )}

      {query.error && (
        <div className="rb-alert" role="alert">
          <span>{query.error.message}</span>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}

      {query.isPending && Boolean(wallet.owner) && Boolean(workflowV2Deployment) && (
        <div className="rb-skeleton-grid" aria-hidden="true">
          <div className="rb-skeleton" />
          <div className="rb-skeleton" />
        </div>
      )}
      {query.isPending && Boolean(wallet.owner) && Boolean(workflowV2Deployment) && (
        <span className="sr-only" role="status">
          Loading workflow activity…
        </span>
      )}

      {!!wallet.owner && query.isSuccess && rows.length > 0 && (
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
          title="No runs yet"
          description="Runs appear here once a trigger fires and the agent evaluates the workflow's conditions."
          action={
            <Link className="app-button" to="/workflows">
              View workflows
            </Link>
          }
          steps={['Trigger fires on Lasna', 'Checks are evaluated', 'Vault settles on Unichain']}
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
                    <span>{v2Network(run.chain).name}</span>
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
                      chain={LASNA_CHAIN_ID}
                      hash={run.lasnaTransaction}
                      label="Lasna decision"
                    />
                    <TransactionLink
                      chain={run.chain}
                      hash={run.destinationTransaction}
                      label="Settlement transaction"
                    />
                    {!requestedId && (
                      <Link to={`/runs/${run.id}`}>
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
          Load more runs
        </button>
      )}
      <V2Feedback wallet={wallet} />
    </section>
  );
}

function RunPath({ run }: { run: z.infer<typeof runSchema> }) {
  const query = useQuery({
    queryKey: ['workflow-v2', 'proof-program', run.agent, run.programHash],
    queryFn: async () => {
      const encoded = await workflowClient(LASNA_CHAIN_ID).readContract({
        address: run.agent,
        abi: workflowAgentV2Abi,
        functionName: 'programs',
        args: [run.programHash],
      });
      return decodeWorkflowV2(encoded);
    },
  });
  if (query.error) return <p role="alert">The historical workflow path could not be read.</p>;
  if (!query.data) return <p role="status">Reading the workflow version…</p>;
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
  | 'withdraw-eth';

type FundingGroup =
  'Vault funds' | 'Execution credit' | 'Watching credit' | 'Allowances' | 'Recovery';

type FundingKind =
  | 'deposit'
  | 'withdraw'
  | 'execution-credit'
  | 'watching-credit'
  | 'allowance'
  | 'revoke-allowance';

type FundingUnit = 'USDC' | 'WETH' | 'ETH' | 'lREACT';

type FundingBalanceKey =
  | 'stable'
  | 'wrapped'
  | 'native'
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
  readonly balanceLabel?: 'Wallet balance' | 'Vault balance';
  readonly validateBalance?: boolean;
}

const fundingGroupOrder: readonly FundingGroup[] = [
  'Vault funds',
  'Execution credit',
  'Watching credit',
  'Allowances',
  'Recovery',
];

const fundingActions: Record<FundsOperation, FundingAction> = {
  'add-usdc': {
    label: 'Deposit USDC',
    group: 'Vault funds',
    kind: 'deposit',
    unit: 'USDC',
    decimals: 6,
    amountLabel: 'Amount (USDC)',
    requiresAmount: true,
    hint: 'Sends test USDC to the vault. USDC pays for buys, transfers, and balance refills.',
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
    hint: 'Sends test WETH to the vault. Only needed for workflows that sell WETH.',
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
    hint: 'Sends test ETH to the Unichain callback proxy for this vault. This credit pays workflow callbacks; it is not held in the vault.',
    balanceKey: 'walletNative',
    balanceLabel: 'Wallet balance',
    validateBalance: true,
  },
  'watch-credit': {
    label: 'Deposit lREACT for watching credit',
    group: 'Watching credit',
    kind: 'watching-credit',
    unit: 'lREACT',
    decimals: 18,
    amountLabel: 'Amount (lREACT)',
    requiresAmount: true,
    hint: 'Sends test lREACT to Reactive Lasna for this agent. Watching credit pays for trigger evaluations.',
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
};

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

export function WorkflowAccountV2() {
  const wallet = useWorkflowV2Wallet();
  const chain = UNICHAIN_SEPOLIA_CHAIN_ID;
  const [operation, setOperation] = useState<FundsOperation>('add-usdc');
  const [amount, setAmount] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const data = useQuery({
    queryKey: ['workflow-v2', 'funding', wallet.owner, chain],
    enabled: Boolean(wallet.owner && settlementFactory()),
    queryFn: () => readFundsV2(wallet.owner!, chain),
    refetchInterval: 12_000,
  });
  const funds = data.data;
  const showRecovery = Boolean(funds && funds.native > 0n);
  const activeOperation = operation === 'withdraw-eth' && !showRecovery ? 'add-usdc' : operation;
  const action = fundingActions[activeOperation];
  const balance = action.balanceKey && funds ? funds[action.balanceKey] : undefined;
  const limit = action.validateBalance ? balance : undefined;
  const groups = fundingGroupOrder
    .map((group) => ({
      group,
      actions: (Object.keys(fundingActions) as FundsOperation[]).filter(
        (key) => fundingActions[key].group === group && (key !== 'withdraw-eth' || showRecovery),
      ),
    }))
    .filter((entry) => entry.actions.length > 0);

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
          throw new Error('Network credit is unavailable for this testnet.');
        await wallet.send(
          watching ? LASNA_CHAIN_ID : chain,
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
        if (token === zeroAddress) throw new Error('This testnet token is unavailable.');
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
      } else {
        const token: Address =
          action.unit === 'USDC' ? funds.usdc : action.unit === 'WETH' ? funds.weth : zeroAddress;
        if (action.unit !== 'ETH' && token === zeroAddress)
          throw new Error('This testnet token is unavailable.');
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
        description="Track testnet balances, watching credit, and execution credit from one place."
        aside={<span className="rb-chip rb-chip--plain">Unichain Sepolia</span>}
      />

      {!wallet.owner && (
        <div className="rb-callout">
          <div className="rb-callout-copy">
            <p className="rb-callout-title">Connect a wallet to open its account</p>
            <p>Balances and credit are read from the agent and vault owned by that wallet.</p>
          </div>
          <WalletControl setup />
        </div>
      )}

      {!wallet.owner && (
        <HowItWorks
          title="What your account holds"
          steps={[
            {
              icon: Coins01Icon,
              title: 'Vault funds',
              copy: 'USDC and WETH principal held by the vault on Unichain Sepolia.',
            },
            {
              icon: Pulse01Icon,
              title: 'Watching credit',
              copy: 'lREACT that pays the agent to monitor triggers on Reactive Lasna.',
            },
            {
              icon: Shield01Icon,
              title: 'Execution credit',
              copy: 'ETH held by the callback proxy to pay for the callbacks that settle runs.',
            },
          ]}
        />
      )}

      {!settlementFactory() && (
        <p className="rb-note">
          <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
          The V2 Vault factory is unavailable on this testnet.
        </p>
      )}

      {data.error && (
        <div className="rb-alert" role="alert">
          <span>{data.error.message}</span>
        </div>
      )}

      {!!wallet.owner && Boolean(settlementFactory()) && data.isPending && (
        <div className="rb-skeleton-grid" aria-hidden="true">
          <div className="rb-skeleton" />
          <div className="rb-skeleton" />
          <div className="rb-skeleton" />
        </div>
      )}
      {!!wallet.owner && Boolean(settlementFactory()) && data.isPending && (
        <span className="sr-only" role="status">
          Reading your testnet account…
        </span>
      )}

      {wallet.owner && funds?.vault === zeroAddress && (
        <section className="rb-setup">
          <div className="rb-setup-head">
            <p className="app-eyebrow">Testnet onboarding</p>
            <h2 className="rb-setup-title">Create your agent and vault</h2>
            <p className="app-heading-copy">
              Rulebook creates a wallet-owned agent on Reactive Lasna and a vault on Unichain
              Sepolia. Both are required before a workflow can be activated.
            </p>
          </div>
          <div className="rb-setup-steps">
            <p className="rb-setup-step">
              <b aria-hidden="true">1</b>
              Approve the agent on Reactive Lasna.
            </p>
            <p className="rb-setup-step">
              <b aria-hidden="true">2</b>
              Approve the vault on Unichain Sepolia.
            </p>
            <p className="rb-setup-step">
              <b aria-hidden="true">3</b>
              Fund vault principal and execution credit.
            </p>
          </div>
          <div className="rb-action-row">
            <button
              className="app-button app-button--primary"
              type="button"
              disabled={wallet.busy}
              onClick={() =>
                void wallet.perform(async (signer) => {
                  await wallet.ensure(signer, chain);
                })
              }
            >
              Create your testnet accounts
            </button>
          </div>
        </section>
      )}
      {funds && funds.vault !== zeroAddress && (
        <>
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
              <p className="rb-balance-foot">Pays callback gas on Unichain Sepolia</p>
            </div>
          </div>

          {funds.native > 0n && (
            <div className="rb-callout rb-callout--recovery">
              <div className="rb-callout-copy">
                <p className="rb-callout-title">Unused vault ETH</p>
                <p>
                  {exactUnits(funds.native, 18)} ETH sits in the vault contract. It is separate from
                  execution credit and does not pay for callbacks.
                </p>
              </div>
              <button
                type="button"
                className="app-button"
                onClick={() => {
                  setOperation('withdraw-eth');
                  setAmount(exactUnits(funds.native, 18));
                  formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  amountRef.current?.focus({ preventScroll: true });
                }}
              >
                Recover ETH
              </button>
            </div>
          )}

          <div className="rb-split">
            <div className="app-panel">
              <div className="rb-panel-head">
                <div>
                  <h2 className="rb-panel-title">Move test funds</h2>
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
                    <select
                      className="app-input"
                      value={activeOperation}
                      aria-describedby="funding-hint"
                      onChange={(event) => {
                        setOperation(event.target.value as FundsOperation);
                        setAmount('');
                      }}
                    >
                      {groups.map(({ group, actions }) => (
                        <optgroup key={group} label={group}>
                          {actions.map((key) => (
                            <option value={key} key={key}>
                              {fundingActions[key].label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
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
                    Watching credit funds Lasna evaluations. The allowance caps USDC refills.
                  </p>
                </div>
              </div>
              <div className="rb-panel-body">
                <div className="rb-credit-list">
                  <div className="rb-credit-row">
                    <span className="rb-credit-name">Watching credit</span>
                    <span className="rb-credit-value">
                      {displayUnits(funds.watch, 18)}
                      <span>lREACT</span>
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
                  Watching credit is held on Reactive Lasna. The refill allowance is approved on
                  Unichain Sepolia.
                </p>
              </div>
            </div>
          </div>

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
                    <span className="rb-address-name">Reactive Lasna Agent</span>
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
