import {
  decodeWorkflow,
  getChain,
  LASNA_CHAIN_ID,
  readAmount,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowIdSchema,
  workflowVaultAbi,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { formatUnits, zeroAddress, zeroHash, type Address, type Hex } from 'viem';
import { PageHeading } from '@/components/chrome/PageHeading';
import { WalletControl } from '@/components/chrome/WalletControl';
import { LoadingRegion, PanelSkeleton, Skeleton } from '@/components/chrome/Skeleton';
import { Spinner } from '@/components/chrome/Spinner';
import { appRoutes } from '@/lib/routes';
import { unichainPublicClient } from '@/lib/wagmi';
import { Field } from './Builder';
import { WalletFeedback } from './Feedback';
import { WorkflowGraph, WorkflowOutline } from './Graph';
import { workflowApi } from './api';
import {
  getPublishedVersions,
  getWorkflowBalances,
  getVaultProgram,
  listWorkflows,
  readWorkflowProgram,
  readWorkflowState,
  readWorkflowTitle,
  useWorkflowAccountQuery,
  useWorkflowWallet,
  workflowDeploymentReady,
} from './chain';

export function Workflows() {
  const account = useWorkflowAccountQuery();
  const wallet = useWorkflowWallet();
  const agent = account.data?.agent;
  const vault = account.data?.vault;
  const rows = useQuery({
    queryKey: ['workflow-list', agent, vault],
    enabled: Boolean(account.data?.linked && agent && vault),
    queryFn: async () => {
      if (!agent || !vault) return [];
      const items = await listWorkflows(agent);
      return Promise.all(
        items.map(async (item) => {
          const auth = await unichainPublicClient.readContract({
            address: vault,
            abi: workflowVaultAbi,
            functionName: 'authorizations',
            args: [item.id],
          });
          return { ...item, status: workflowStatus(item.entry, auth) };
        }),
      );
    },
    refetchInterval: 12_000,
  });
  return (
    <section className="app-page workflow-page">
      <PageHeading
        title="Workflows"
        description="Manage what runs from your wallet and check what happened."
      />
      <div className="workflow-actions">
        <Link className="app-button app-button--primary" to="/workflows/new">
          New workflow
        </Link>
        {!wallet.owner && <WalletControl setup />}
      </div>
      {!workflowDeploymentReady && (
        <p className="app-copy">
          The builder is available. Activation requires a configured testnet deployment.
        </p>
      )}
      <QueryStatus error={account.error ?? rows.error} />
      {Boolean(
        wallet.owner &&
        workflowDeploymentReady &&
        (account.isPending || (account.data?.linked && rows.isPending)),
      ) && (
        <LoadingRegion label="Reading your workflows…">
          <PanelSkeleton rows={2} />
        </LoadingRegion>
      )}
      {rows.data?.length === 0 && (
        <p className="app-copy">No workflows have been activated from this wallet.</p>
      )}
      {!!rows.data?.length && (
        <div className="app-panel workflow-workspace-list">
          {rows.data.map((item) => (
            <Link to={'/workflows/' + item.id} key={item.id} className="workflow-workspace-row">
              <strong>{item.title}</strong>
              <span className="workflow-status">{item.status}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function workflowStatus(
  entry: Awaited<ReturnType<typeof readWorkflowState>>['entry'],
  auth: Awaited<ReturnType<typeof readWorkflowState>>['auth'],
) {
  if (entry[6] && auth[4]) return 'Cancelled';
  if (auth[4]) return 'Finish cancellation';
  if (!auth[3] && entry[5]) return 'Finish pausing';
  if (!auth[3]) return 'Paused';
  if (!entry[5] || entry[0] !== auth[0] || entry[1] !== auth[1]) return 'Finish activation';
  return 'Active';
}

export function WorkflowDetail() {
  const { id: raw } = useParams();
  const parsed = workflowIdSchema.safeParse(raw);
  const id = parsed.success ? parsed.data : undefined;
  const account = useWorkflowAccountQuery();
  const wallet = useWorkflowWallet();
  const [description, setDescription] = useState('');
  const [cancel, setCancel] = useState(false);
  const addresses = account.data;
  const query = useQuery({
    queryKey: ['workflow-detail', addresses?.agent, id],
    enabled: Boolean(id && addresses?.linked),
    queryFn: async () => {
      if (!addresses || !id) throw new Error('Connect the workflow owner’s wallet.');
      const { entry, auth } = await readWorkflowState(addresses.agent, addresses.vault, id);
      if (entry[1] === 0n) throw new Error('This wallet does not own the workflow.');
      const [program, title, publications] = await Promise.all([
        readWorkflowProgram(addresses.agent, entry[0]),
        readWorkflowTitle(addresses.agent, id),
        getPublishedVersions(addresses.agent, id),
      ]);
      const status = workflowStatus(entry, auth);
      const draft = decodeWorkflow(program, title);
      const staged =
        auth[3] && auth[1] > entry[1]
          ? decodeWorkflow(await getVaultProgram(addresses.vault, auth[0]), title)
          : undefined;
      return { draft, staged, status, programHash: entry[0], publications };
    },
    refetchInterval: 10_000,
  });
  const history = useQuery({
    queryKey: ['workflow-runs', addresses?.agent, id],
    enabled: Boolean(id && addresses?.linked),
    queryFn: ({ signal }) => workflowApi.runs(addresses!.agent, id!, signal),
    refetchInterval: 10_000,
  });
  if (!id) return <p role="alert">This workflow link is invalid.</p>;
  const reading = query.data;
  if (!reading)
    return (
      <section className="app-page workflow-page">
        <PageHeading title="Workflow" />
        {!wallet.owner ? (
          <WalletControl setup />
        ) : query.isPending || account.isPending ? (
          <LoadingRegion label="Reading your workflow…" className="rb-page-skeleton">
            <Skeleton className="rb-skeleton--canvas" />
            <Skeleton className="rb-skeleton--panel" />
          </LoadingRegion>
        ) : (
          <QueryStatus error={query.error ?? account.error} />
        )}
        {wallet.owner && !account.isPending && !addresses?.linked && (
          <Link className="app-link" to="/account">
            Set up your workflow account
          </Link>
        )}
      </section>
    );
  const { draft, staged, status, programHash, publications } = reading;
  const active = status === 'Active';
  const closed = status === 'Cancelled';
  return (
    <section className="app-page workflow-page">
      <Link className="app-link" to="/workflows">
        All workflows
      </Link>
      <PageHeading title={draft.title} description={status} />
      {!closed && (
        <div className="workflow-actions">
          {status !== 'Finish cancellation' && (
            <Link className="app-button" to={'/workflows/' + id + '/edit'}>
              Edit workflow
            </Link>
          )}
          {(active || status === 'Finish pausing') && (
            <button
              className="app-button"
              type="button"
              disabled={wallet.busy}
              onClick={() => void wallet.disable(id, false)}
            >
              {active ? 'Pause workflow' : 'Finish pausing'}
            </button>
          )}
          {(status === 'Paused' || status === 'Finish activation') && (
            <button
              className="app-button app-button--primary"
              type="button"
              disabled={wallet.busy}
              onClick={() => void wallet.activate(id, staged ?? draft, 0n)}
            >
              {status === 'Paused' ? 'Resume workflow' : 'Finish activation'}
            </button>
          )}
          <button
            className="app-button"
            type="button"
            disabled={wallet.busy}
            onClick={() => setCancel(!cancel)}
          >
            {status === 'Finish cancellation' ? 'Finish cancellation' : 'Cancel workflow'}
          </button>
        </div>
      )}
      {cancel && (
        <div className="app-panel app-panel-pad">
          <p>Cancel this workflow permanently? You can still withdraw your funds.</p>
          <button
            className="app-button"
            type="button"
            disabled={wallet.busy}
            onClick={() =>
              void wallet.disable(id, true).then((ok) => {
                if (ok) setCancel(false);
              })
            }
          >
            Confirm cancellation
          </button>
        </div>
      )}
      <WalletFeedback wallet={wallet} />
      <WorkflowGraph draft={draft} />
      <div className="app-panel app-panel-pad">
        <h2 className="app-panel-heading">Workflow summary</h2>
        <WorkflowOutline draft={draft} />
      </div>
      {(active || publications.length > 0) && (
        <section className="app-panel app-panel-pad">
          <h2 className="app-panel-heading">Marketplace</h2>
          {publications.map(({ listingId, programHash: listedHash }) => (
            <div className="workflow-workspace-row" key={listingId.toString()}>
              <Link className="app-link" to={'/marketplace/' + listingId}>
                {listedHash === programHash
                  ? 'Current published version'
                  : 'Published version ' + listingId}
              </Link>
              <button
                type="button"
                className="app-button"
                disabled={wallet.busy}
                onClick={() => void wallet.unpublish(listingId)}
              >
                Unpublish
              </button>
            </div>
          ))}
          {active && !publications.some((item) => item.programHash === programHash) && (
            <form
              className="workflow-publish"
              onSubmit={(event) => {
                event.preventDefault();
                void wallet.publish(id, draft.title, description);
              }}
            >
              <Field label="Listing description">
                <textarea
                  className="app-input"
                  maxLength={280}
                  required
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
              <p className="app-copy">Anyone can read the published version and make a copy.</p>
              <button type="submit" className="app-button" disabled={wallet.busy}>
                Publish workflow
              </button>
            </form>
          )}
        </section>
      )}
      <section className="app-panel app-panel-pad" aria-label="Recent runs">
        <h2 className="app-panel-heading">Recent runs</h2>
        <QueryStatus error={history.error} />
        {history.isPending && (
          <LoadingRegion label="Loading recent runs…">
            <PanelSkeleton rows={2} />
          </LoadingRegion>
        )}
        {history.data?.runs.length === 0 && (
          <p className="app-copy">Runs will appear here after the Agent sees a matching event.</p>
        )}
        {history.data?.runs.map((run) => (
          <Link key={run.id} to={'/runs/' + run.id} className="workflow-workspace-row">
            <strong>{run.status}</strong>
            <span>{run.originTransaction.slice(0, 12)}…</span>
          </Link>
        ))}
      </section>
    </section>
  );
}

export function WorkflowRunDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const parsed = workflowIdSchema.safeParse(id);
  const query = useQuery({
    queryKey: ['workflow-run', id],
    enabled: parsed.success,
    queryFn: ({ signal }) => workflowApi.run(id!, signal),
    refetchInterval: 12_000,
  });
  const run = query.data;
  const activityHref =
    state?.activityFilter === 'attention'
      ? { pathname: appRoutes.activity, search: '?filter=attention' }
      : appRoutes.activity;
  const breadcrumb = <Link to={activityHref}>Activity</Link>;
  if (!parsed.success) return <p role="alert">This run link is invalid.</p>;
  if (!run)
    return (
      <section className="app-page workflow-page">
        <PageHeading title="Run proof" breadcrumb={breadcrumb} />
        {query.isPending ? (
          <LoadingRegion label="Reading the run proof…" className="rb-page-skeleton">
            <Skeleton className="rb-skeleton--canvas" />
            <Skeleton className="rb-skeleton--panel" />
          </LoadingRegion>
        ) : (
          <QueryStatus error={query.error} />
        )}
      </section>
    );
  const draft = decodeWorkflow(run.program, 'Workflow');
  const amount =
    draft.trigger === 'payment'
      ? formatUnits(BigInt(run.observed), 6) + ' USDC'
      : draft.trigger === 'price'
        ? formatUnits(BigInt(run.observed), 18) + ' USDC per WETH'
        : new Date(Number(run.observed) * 1_000).toLocaleString();
  return (
    <section className="app-page workflow-page">
      <PageHeading title="Run proof" description={run.status} breadcrumb={breadcrumb} />
      <p className="app-copy">
        Observed {amount}. The highlighted path shows the Agent’s decision.
      </p>
      <WorkflowGraph draft={draft} leaf={run.leaf} />
      <div className="app-panel app-panel-pad">
        <h2 className="app-panel-heading">Chosen path and receipts</h2>
        <WorkflowOutline draft={draft} leaf={run.leaf} />
        <ul className="workflow-receipts">
          <Receipt
            chain={run.originChain}
            hash={run.originTransaction}
            label={'Origin event · log ' + run.originLogIndex}
          />
          <Receipt chain={LASNA_CHAIN_ID} hash={run.lasnaTransaction} label="Agent decision" />
          {run.destinationTransaction && (
            <Receipt
              chain={UNICHAIN_SEPOLIA_CHAIN_ID}
              hash={run.destinationTransaction}
              label={run.status === 'Completed' ? 'Completed actions' : 'Destination outcome'}
            />
          )}
        </ul>
        {run.reason && run.reason !== '0x00000000' && run.status === 'Failed' && (
          <p className="app-copy">The Vault stopped the run. Error code {run.reason}.</p>
        )}
        {run.steps.length > 0 && (
          <ol className="workflow-settled-steps">
            {run.steps.map((step) => (
              <li key={step.index}>
                {step.kind === 1
                  ? 'Sent ' + formatUnits(BigInt(step.amount), 6) + ' USDC to ' + step.recipient
                  : step.kind === 2
                    ? 'Spent ' +
                      formatUnits(BigInt(step.amount), 6) +
                      ' USDC and received ' +
                      formatUnits(BigInt(step.received), 18) +
                      ' WETH'
                    : 'Recorded an on-chain alert'}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Receipt({ chain, hash, label }: { chain: number; hash: Hex; label: string }) {
  const network = getChain(chain);
  return (
    <li>
      <a
        target="_blank"
        rel="noreferrer"
        className="app-link"
        href={network.explorerUrl + '/tx/' + hash}
      >
        {label} on {network.name}
      </a>
    </li>
  );
}

const funds = [
  { id: 'watch', label: 'Add watching credit', unit: 'lREACT', decimals: 18 },
  { id: 'execution', label: 'Add execution credit', unit: 'ETH', decimals: 18 },
  { id: 'usdc', label: 'Send test USDC to Vault', unit: 'USDC', decimals: 6 },
  { id: 'withdraw-usdc', label: 'Withdraw USDC', unit: 'USDC', decimals: 6 },
  { id: 'withdraw-weth', label: 'Withdraw WETH', unit: 'WETH', decimals: 18 },
] as const;

export function WorkflowAccount() {
  const account = useWorkflowAccountQuery();
  const wallet = useWorkflowWallet();
  const [action, setAction] = useState<(typeof funds)[number]>(funds[0]);
  const [amount, setAmount] = useState('');
  const [entryError, setEntryError] = useState('');
  const addresses = account.data;
  const balances = useQuery({
    queryKey: ['workflow-balances', wallet.owner, addresses?.vault],
    enabled: Boolean(wallet.owner && addresses?.linked),
    queryFn: () => getWorkflowBalances(wallet.owner!, addresses!.agent, addresses!.vault),
    refetchInterval: 15_000,
  });
  const pending = useQuery({
    queryKey: ['workflow-pending-payment', addresses?.vault],
    enabled: Boolean(addresses?.linked),
    queryFn: async () => {
      const id = await unichainPublicClient.readContract({
        address: addresses!.vault,
        abi: workflowVaultAbi,
        functionName: 'paymentWorkflow',
      });
      if (id === zeroHash) return null;
      const state = await readWorkflowState(addresses!.agent, addresses!.vault, id);
      return state.entry[1] === 0n ? id : null;
    },
  });
  const ready = addresses?.linked === true;
  return (
    <section className="app-page workflow-page">
      <PageHeading
        title="Account & Vault"
        description="Manage your testnet addresses, fees, and funds."
      />
      {!wallet.owner && <WalletControl setup />}
      {!workflowDeploymentReady && (
        <p className="app-copy">
          Workflow factories must be configured before you can create an account.
        </p>
      )}
      {wallet.owner && workflowDeploymentReady && (
        <>
          <QueryStatus error={account.error} />
          {account.isPending && (
            <LoadingRegion label="Reading your workflow account…">
              <PanelSkeleton rows={3} />
            </LoadingRegion>
          )}
          {addresses && !ready && (
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={wallet.busy}
              onClick={() => void wallet.setup()}
            >
              Set up workflow account
            </button>
          )}
        </>
      )}
      {ready && addresses && (
        <>
          <dl className="workflow-balances app-panel app-panel-pad">
            <div>
              <dt>Watching credit</dt>
              <dd>{balance(balances.data?.watch, 18, 'lREACT')}</dd>
            </div>
            <div>
              <dt>Execution credit</dt>
              <dd>{balance(balances.data?.execution, 18, 'ETH')}</dd>
            </div>
            <div>
              <dt>Vault balance</dt>
              <dd>
                {balance(balances.data?.usdc, 6, 'USDC')} ·{' '}
                {balance(balances.data?.weth, 18, 'WETH')}
              </dd>
            </div>
            <div>
              <dt>Agent on Reactive Lasna</dt>
              <dd>
                <AccountLink chain={LASNA_CHAIN_ID} address={addresses.agent} />
              </dd>
            </div>
            <div>
              <dt>Vault on Unichain Sepolia</dt>
              <dd>
                <AccountLink chain={UNICHAIN_SEPOLIA_CHAIN_ID} address={addresses.vault} />
              </dd>
            </div>
            <div>
              <dt>Wallet balance</dt>
              <dd>{balance(balances.data?.walletUsdc, 6, 'USDC')}</dd>
            </div>
          </dl>
          <QueryStatus error={balances.error} />
          {balances.isPending && (
            <LoadingRegion label="Reading your balances…">
              <PanelSkeleton rows={3} rowClassName="rb-skeleton--table-row" />
            </LoadingRegion>
          )}
          <div className="workflow-actions">
            <a
              className="app-link"
              href="https://dev.reactive.network/reactive-mainnet#reactive-faucet"
              target="_blank"
              rel="noreferrer"
            >
              Get testnet lREACT
            </a>
            <a
              className="app-link"
              href="https://faucet.circle.com/"
              target="_blank"
              rel="noreferrer"
            >
              Get testnet USDC
            </a>
            <a
              className="app-link"
              href="https://console.optimism.io/faucet"
              target="_blank"
              rel="noreferrer"
            >
              Get testnet ETH
            </a>
          </div>
          {pending.data && (
            <section className="app-panel app-panel-pad">
              <p>
                An unfinished payment workflow is authorized on your Vault. Return to its draft to
                finish, or revoke that authorization here.
              </p>
              <button
                type="button"
                className="app-button"
                disabled={wallet.busy}
                onClick={() => void wallet.disable(pending.data!, false)}
              >
                Revoke unfinished authorization
              </button>
            </section>
          )}
          <form
            className="app-panel app-panel-pad workflow-funds"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                setEntryError('');
                void wallet
                  .fund(action.id, readAmount(amount, action.decimals, 'amount'))
                  .then((done) => {
                    if (done) setAmount('');
                  });
              } catch (error) {
                setEntryError(error instanceof Error ? error.message : 'Check the amount.');
              }
            }}
          >
            <Field label="Action">
              <select
                className="app-input"
                value={action.id}
                onChange={(event) =>
                  setAction(funds.find((item) => item.id === event.target.value) ?? funds[0])
                }
              >
                {funds.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={'Amount in ' + action.unit}>
              <input
                className="app-input"
                inputMode="decimal"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <button className="app-button app-button--primary" type="submit" disabled={wallet.busy}>
              Review transaction
            </button>
            {entryError && (
              <p className="workflow-error" role="alert">
                {entryError}
              </p>
            )}
          </form>
        </>
      )}
      <details className="app-panel app-panel-pad workflow-funding-guide">
        <summary className="app-panel-heading">Fees and funding</summary>
        <dl>
          <div>
            <dt>Watching credit</dt>
            <dd>
              Use Add watching credit to pay for trigger monitoring in testnet lREACT on Reactive
              Lasna.
            </dd>
          </div>
          <div>
            <dt>Execution credit</dt>
            <dd>
              Use Add execution credit to pay for workflow runs in testnet ETH on Unichain Sepolia.
            </dd>
          </div>
          <div>
            <dt>Vault balance</dt>
            <dd>Keep the testnet tokens your workflow needs to send or swap in your Vault.</dd>
          </div>
        </dl>
      </details>
      <WalletFeedback wallet={wallet} />
    </section>
  );
}

function balance(amount: bigint | undefined, decimals: number, unit: string) {
  return amount === undefined ? 'Unavailable' : formatUnits(amount, decimals) + ' ' + unit;
}

function AccountLink({ chain, address }: { chain: number; address: Address }) {
  if (address === zeroAddress) return null;
  return (
    <a
      className="app-link workflow-address"
      target="_blank"
      rel="noreferrer"
      href={getChain(chain).explorerUrl + '/address/' + address}
    >
      {address}
    </a>
  );
}

function QueryStatus({ pending = false, error }: { pending?: boolean; error: Error | null }) {
  return error ? (
    <p role="alert" className="workflow-error">
      {error.message.split('\n')[0]}
    </p>
  ) : pending ? (
    <Spinner label="Loading…" />
  ) : null;
}
