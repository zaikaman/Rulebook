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
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
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
  return (
    <section className="app-page workflow-page workflow-v2-stack">
      <PageHeading
        title="Workflows"
        description="Manage the testnet workflows that run from your wallet."
      />
      <div className="workflow-actions">
        <Link className="app-button app-button--primary" to="/workflows/new">
          New workflow
        </Link>
        {!owner && <WalletControl setup />}
      </div>
      {!workflowV2Deployment && (
        <p className="app-copy">
          Browse the workflow recipes and build a draft while testnet activation is being
          configured.
        </p>
      )}
      {rows.isFetching && !rows.data && <p role="status">Reading your workflows…</p>}
      {rows.error && (
        <p className="workflow-error" role="alert">
          {rows.error.message}
        </p>
      )}
      {rows.data?.length === 0 && <p className="app-copy">This wallet has no workflows yet.</p>}
      {!!rows.data?.length && (
        <ul className="app-panel workflow-workspace-list">
          {rows.data.map((row) => (
            <li key={row.id}>
              <Link to={`/workflows/${row.id}`} className="workflow-workspace-row">
                <strong>{row.title}</strong>
                <span>
                  {v2Network(row.chain).name} ·{' '}
                  {row.active
                    ? 'Watching for events'
                    : row.staged && row.auth[3]
                      ? 'Finish activation'
                      : 'Stopped'}
                </span>
              </Link>
            </li>
          ))}
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
    <section className="app-page workflow-page workflow-v2-stack">
      <PageHeading title={item.title} description={`${v2Network(item.chain).name} · ${status}`} />
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
      <div className="app-panel app-panel-pad">
        <WorkflowCanvas draft={diagramV2(toDraft(program, item.title)).canvas} />
        <WorkflowProgramSummary draft={toDraft(program, item.title)} />
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

export function WorkflowActivityV2() {
  const wallet = useWorkflowV2Wallet();
  const { id: requestedId } = useParams();
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
  return (
    <section className="app-page workflow-page workflow-v2-stack">
      <PageHeading
        title="Activity"
        description="Follow the origin event, Lasna callback, and settlement."
      />
      {!wallet.owner && <WalletControl setup />}
      {!workflowV2Deployment && (
        <p className="app-copy">Activity opens when the V2 testnet deployment is configured.</p>
      )}
      {query.isFetching && !query.data && <p role="status">Loading workflow activity…</p>}
      {query.error && (
        <p className="workflow-error" role="alert">
          {query.error.message}{' '}
          <button
            className="workflow-text-button"
            type="button"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {query.isSuccess && !rows.length && <p className="app-copy">No matching runs yet.</p>}
      {!!rows.length && (
        <ul className="workflow-v2-activity">
          {rows.map((run) => (
            <li
              key={`${run.chain}:${run.id}`}
              className="app-panel app-panel-pad workflow-v2-stack"
            >
              <div className="workflow-actions">
                <Link className="app-link" to={`/workflows/${run.workflowId}`}>
                  {run.title}
                </Link>
                <span className="workflow-status">{run.status}</span>
              </div>
              <p className="app-copy">
                {v2Network(run.chain).name}
                {run.reason && ` · ${run.reason}`}
              </p>
              <div className="workflow-actions">
                <TransactionLink
                  chain={run.originChain}
                  hash={run.originTransaction}
                  label="Origin event"
                />
                {!requestedId && (
                  <Link className="app-link" to={`/runs/${run.id}`}>
                    Run details
                  </Link>
                )}
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
              </div>
              {requestedId && run.path !== null && <RunPath run={run} />}
            </li>
          ))}
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
  | 'withdraw-eth'
  | 'approve-refill-usdc'
  | 'revoke-refill-usdc'
  | 'watch-credit'
  | 'run-credit';
const fundsLabels: Record<FundsOperation, string> = {
  'add-usdc': 'Deposit USDC',
  'add-weth': 'Deposit WETH',
  'withdraw-usdc': 'Withdraw USDC',
  'withdraw-weth': 'Withdraw WETH',
  'withdraw-eth': 'Withdraw Vault ETH',
  'approve-refill-usdc': 'Set USDC refill allowance',
  'revoke-refill-usdc': 'Revoke USDC refill allowance',
  'watch-credit': 'Add Lasna watching credit',
  'run-credit': 'Add testnet execution credit',
};

export function WorkflowAccountV2() {
  const wallet = useWorkflowV2Wallet();
  const chain = UNICHAIN_SEPOLIA_CHAIN_ID;
  const [operation, setOperation] = useState<FundsOperation>('add-usdc');
  const [amount, setAmount] = useState('');
  const data = useQuery({
    queryKey: ['workflow-v2', 'funding', wallet.owner, chain],
    enabled: Boolean(wallet.owner && settlementFactory()),
    queryFn: () => readFundsV2(wallet.owner!, chain),
    refetchInterval: 12_000,
  });
  const funds = data.data;
  const operations = Object.entries(fundsLabels);
  const revokeRefill = operation === 'revoke-refill-usdc';

  function submit() {
    void wallet.perform(async () => {
      if (!funds || funds.vault === zeroAddress)
        throw new Error('Create your Agent and Vault first.');
      const symbol = operation.endsWith('usdc')
        ? 'USDC'
        : operation.endsWith('weth')
          ? 'WETH'
          : operation === 'watch-credit'
            ? 'lREACT'
            : 'ETH';
      const quantity = revokeRefill
        ? 0n
        : readAmount(amount, symbol === 'USDC' ? 6 : 18, 'funding amount');
      if (!revokeRefill && quantity === 0n) throw new Error('Enter a positive amount.');
      const display = `${formatUnits(quantity, symbol === 'USDC' ? 6 : 18)} ${symbol}`;
      if (operation === 'approve-refill-usdc' || revokeRefill) {
        await wallet.send(
          chain,
          funds.usdc,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [funds.vault, quantity],
          }),
          revokeRefill
            ? 'Stop your Vault from pulling any more USDC from your wallet.'
            : 'Set the total USDC your Vault may pull for balance refills.',
          display,
        );
      } else if (operation === 'watch-credit' || operation === 'run-credit') {
        const watch = operation === 'watch-credit';
        const provider = watch ? funds.lasnaSystem : funds.proxy;
        if (!provider) throw new Error('Execution credit is unavailable for this testnet.');
        await wallet.send(
          watch ? LASNA_CHAIN_ID : chain,
          provider,
          encodeFunctionData({
            abi: executionCreditAbi,
            functionName: 'depositTo',
            args: [watch ? funds.agent : funds.vault],
          }),
          fundsLabels[operation],
          display,
          quantity,
        );
      } else {
        const token: Address =
          symbol === 'USDC' ? funds.usdc : symbol === 'WETH' ? funds.weth : zeroAddress;
        if (operation.startsWith('add-')) {
          await wallet.send(
            chain,
            token,
            encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [funds.vault, quantity],
            }),
            'Send test tokens to your workflow Vault.',
            display,
          );
        } else {
          await wallet.send(
            chain,
            funds.vault,
            encodeFunctionData({
              abi: workflowVaultV2Abi,
              functionName: 'withdraw',
              args: [token, quantity],
            }),
            'Return funds from the Vault to your wallet.',
            display,
          );
        }
      }
      setAmount('');
    });
  }

  return (
    <section className="app-page workflow-page workflow-v2-stack">
      <PageHeading
        title="Account & Vault"
        description="Manage testnet balances, watching credit, and execution credit."
      />
      {!wallet.owner && <WalletControl setup />}
      {!settlementFactory() && (
        <p className="app-copy">The V2 Vault factory is unavailable on this testnet.</p>
      )}
      {data.isFetching && !funds && <p role="status">Reading your testnet account…</p>}
      {data.error && (
        <p className="workflow-error" role="alert">
          {data.error.message}
        </p>
      )}
      {wallet.owner && funds?.vault === zeroAddress && (
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
      )}
      {funds && funds.vault !== zeroAddress && (
        <div className="app-panel app-panel-pad workflow-v2-stack">
          <dl className="workflow-v2-summary">
            <div>
              <dt>Reactive Lasna Agent</dt>
              <dd className="workflow-v2-address">{funds.agent}</dd>
            </div>
            <div>
              <dt>{v2Network(chain).name} Vault</dt>
              <dd className="workflow-v2-address">{funds.vault}</dd>
            </div>
            <div>
              <dt>Vault balance</dt>
              <dd>
                {formatUnits(funds.stable, 6)} USDC · {formatUnits(funds.native, 18)} ETH
                {chain === UNICHAIN_SEPOLIA_CHAIN_ID && ` · ${formatUnits(funds.wrapped, 18)} WETH`}
              </dd>
            </div>
            <div>
              <dt>Automation credit</dt>
              <dd>
                {formatUnits(funds.watch, 18)} lREACT watching · {formatUnits(funds.execution, 18)}{' '}
                ETH execution
              </dd>
            </div>
            <div>
              <dt>Remaining refill allowance</dt>
              <dd>{formatUnits(funds.refillAllowance, 6)} USDC</dd>
            </div>
          </dl>
          <form
            className="workflow-v2-settings"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <V2Field name="Funding action">
              <select
                className="app-input"
                value={operation}
                onChange={(event) => setOperation(event.target.value as FundsOperation)}
              >
                {operations.map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </V2Field>
            {!revokeRefill && (
              <V2Field name="Amount">
                <input
                  className="app-input"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </V2Field>
            )}
            <button
              className="app-button app-button--primary"
              disabled={wallet.busy || (!revokeRefill && !amount.trim())}
              type="submit"
            >
              Review transaction
            </button>
          </form>
        </div>
      )}
      <V2Feedback wallet={wallet} />
    </section>
  );
}
