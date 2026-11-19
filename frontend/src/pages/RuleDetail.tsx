import { ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  agentAbi,
  agentFactoryAbi,
  alertTemplateSchema,
  getTemplate,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAccount, useReadContract } from 'wagmi';

import { AddressLink } from '../components/AddressLink.js';
import { BudgetAtRiskBanner } from '../components/BudgetAtRiskBanner.js';
import { BudgetMeter } from '../components/BudgetMeter.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { ExecutionTable } from '../components/ExecutionTable.js';
import { DetachMirror } from '../components/MirrorForm.js';
import { NetworkBadge } from '../components/NetworkBadge.js';
import { PriceLabel } from '../components/PriceLabel.js';
import { TxLink } from '../components/TxLink.js';
import { RuleActions } from '../components/RuleActions.js';
import { StatusPill } from '../components/StatusPill.js';
import { composerForRule } from '../composer/replaceRule.js';
import { TelegramNotifications } from '../components/TelegramNotifications.js';
import { useRuleControl } from '../hooks/useRuleControl.js';
import { useRuleFunds } from '../hooks/useRuleFunds.js';
import { api, ApiError } from '../lib/api.js';
import { AGENT_FACTORY_ADDRESS, DEMO_USDC } from '../lib/contracts.js';
import { appRoutes } from '../lib/routes.js';
import { lastRunLabel, ruleLifecycle, ruleSentence, RULE_FLAGS } from '../lib/rules.js';
import { signatureTokenAmount } from '../lib/signatures.js';
import { lasnaPublicClient } from '../lib/wagmi.js';
import { CreateRuleForm, useComposerVaultTerms } from './Create.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const INDEXER_RETRY_DELAY_MS = 5_000;
const INDEXER_RETRY_LIMIT = 12;
/** Templates whose condition reads a cached pair price. */
const PRICE_TEMPLATES = new Set([2, 3, 4, 5, 6, 11, 12]);

class RuleIndexingError extends Error {}

/** The Agent's cached last traded price, labelled with the observation time (FR-020). */
function CachedPrice({ agent, pair }: { readonly agent: Address; readonly pair: Address }) {
  const { data } = useReadContract({
    address: agent,
    abi: agentAbi,
    functionName: 'getCachedPrice',
    args: [pair],
    chainId: LASNA_CHAIN_ID,
  });
  if (!data) return null;
  const [price, observedAt] = data;
  return (
    <PriceLabel price={price} observedAt={Number(observedAt)} chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
  );
}

/** `/rules/:agent/:ruleId`: the sentence, its parameters, and the execution history. */
export function RuleDetail() {
  const { agent, ruleId } = useParams();
  const { address } = useAccount();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const agentAddress = (agent as Address | undefined) ?? ZERO;
  const id = ruleId && /^\d{1,78}$/.test(ruleId) ? BigInt(ruleId) : null;
  const editing = search.get('edit') === '1';
  const detailPath = `/rules/${agentAddress}/${ruleId}`;
  const chainRule = useQuery({
    queryKey: ['rule-chain', agent?.toLowerCase(), ruleId],
    queryFn: () => readRule(agentAddress, id ?? 0n),
    enabled: !!agent && id !== null,
    refetchInterval: 30_000,
  });
  const detailQuery = useQuery({
    queryKey: ['rule', agent?.toLowerCase(), ruleId],
    queryFn: async () => {
      try {
        return await api.ruleDetail(agent as string, ruleId as string);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404 || error.code !== 'not_found') {
          throw error;
        }

        if (
          !chainRule.data?.template &&
          !(await chainRule.refetch({ cancelRefetch: false })).data?.template
        ) {
          throw error;
        }
        throw new RuleIndexingError('Rule confirmed on Reactive Lasna.');
      }
    },
    enabled: !!agent && id !== null,
    retry: (failureCount, error) =>
      error instanceof RuleIndexingError && failureCount < INDEXER_RETRY_LIMIT,
    retryDelay: INDEXER_RETRY_DELAY_MS,
  });

  const ownerQuery = useReadContract({
    address: (agent as Address | undefined) ?? ZERO,
    abi: agentAbi,
    functionName: 'owner',
    chainId: LASNA_CHAIN_ID,
    query: {
      enabled: !!address && !!agent,
    },
  });

  const isOwner = !!address && ownerQuery.data?.toLowerCase() === address.toLowerCase();
  const storedRule = detailQuery.data?.rule;
  const liveRule = chainRule.data?.template ? chainRule.data : undefined;
  const lifecycle = storedRule ? ruleLifecycle(storedRule, liveRule?.flags) : undefined;
  const terminal = lifecycle === 'cancelled';
  const funds = useRuleFunds(
    agentAddress,
    storedRule,
    lifecycle === 'active' && !!liveRule && (liveRule.flags & RULE_FLAGS.mirrored) === 0,
  );
  const currentAccount = useReadContract({
    address: AGENT_FACTORY_ADDRESS ?? ZERO,
    abi: agentFactoryAbi,
    functionName: 'agentOf',
    args: [address ?? ZERO],
    chainId: LASNA_CHAIN_ID,
    query: { enabled: !!funds && isOwner && !!AGENT_FACTORY_ADDRESS },
  });
  const control = useRuleControl(agent ? agentAddress : null);
  const editCapability = useReadContract({
    address: agentAddress,
    abi: agentAbi,
    functionName: 'getEvaluationOrder',
    chainId: LASNA_CHAIN_ID,
    query: { enabled: isOwner && !!storedRule && !terminal, retry: false, staleTime: Infinity },
  });
  const replacement = useQuery({
    queryKey: ['rule-replacement', agent?.toLowerCase(), ruleId],
    queryFn: () =>
      lasnaPublicClient.readContract({
        address: agentAddress,
        abi: agentAbi,
        functionName: 'replacementFor',
        args: [id ?? 0n],
      }),
    enabled: terminal && !!agent && id !== null,
    retry: false,
  });
  const editable =
    isOwner &&
    editCapability.isSuccess &&
    !!liveRule &&
    !terminal &&
    (liveRule.flags & RULE_FLAGS.mirrored) === 0;

  const breadcrumb = (
    <>
      <Link to={appRoutes.rules}>Your rules</Link>
      <HugeiconsIcon icon={ArrowRight02Icon} size={12} aria-hidden="true" />
      <span aria-current="page">Detail</span>
    </>
  );

  if (!detailQuery.data && detailQuery.failureReason instanceof RuleIndexingError) {
    return (
      <section className="app-page">
        <PageHeading title="Rule details" breadcrumb={breadcrumb} />
        <div className="app-panel app-panel-pad space-y-3">
          <div role="status" className="space-y-2">
            <h2 className="app-panel-heading">Syncing rule details</h2>
            <p className="app-copy">
              Your rule is confirmed on Reactive Lasna.{' '}
              {detailQuery.isError
                ? 'Its details are taking longer than usual to sync.'
                : 'This page will update automatically.'}
            </p>
          </div>
          {detailQuery.isError ? (
            <button type="button" onClick={() => void detailQuery.refetch()} className="app-button">
              Check again
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <section aria-busy="true" className="app-page">
        <PageHeading title="Rule details" breadcrumb={breadcrumb} />
        <div className="app-skeleton h-40 animate-pulse" />
        <div className="app-skeleton h-24 animate-pulse" />
      </section>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <section className="app-page">
        <PageHeading title="Rule details" breadcrumb={breadcrumb} />
        <ErrorState
          message="This rule could not be loaded."
          detail={
            detailQuery.error instanceof Error
              ? detailQuery.error.message
              : 'The indexer has no record of it yet.'
          }
          chainId={LASNA_CHAIN_ID}
          onRetry={() => void detailQuery.refetch()}
        />
      </section>
    );
  }

  const { rule, recent_executions: executions, budget, sponsor, mirror } = detailQuery.data;
  const alerts = detailQuery.data.alerts ?? [];
  const currentRuleId = rule.rule_id;
  const successor = rule.replaced_by ?? replacement.data;
  const status = successor
    ? 'replaced'
    : funds
      ? 'waiting-funds'
      : (lifecycle ?? ruleLifecycle(rule));

  if (editing && editable && liveRule) {
    return (
      <section className="app-page">
        <PageHeading
          title={`Edit rule #${currentRuleId}`}
          description={
            liveRule.flags === RULE_FLAGS.active
              ? 'The new rule keeps its priority. A buy already sent to your Vault can still finish.'
              : 'The updated rule starts paused. Resume it when you want it to run.'
          }
          aside={
            <Link to={detailPath} className="app-button">
              Back to rule
            </Link>
          }
          focusOnMount
        />
        <EditRuleComposer
          key={detailPath}
          agent={agentAddress}
          ruleId={currentRuleId}
          liveRule={liveRule}
          sentence={ruleSentence(rule)}
          onEdited={(nextId) =>
            void navigate(`/rules/${agentAddress}/${nextId}`, { replace: true })
          }
        />
      </section>
    );
  }

  return (
    <section className="app-page">
      <PageHeading
        title={`Rule #${currentRuleId.toString()}`}
        breadcrumb={breadcrumb}
        aside={<StatusPill status={status} />}
      />

      {funds && (
        <div className="app-alert" data-tone="warning" role="status">
          <p>
            {funds.available} available in the Vault. This rule needs {funds.required} per run.
          </p>
          {isOwner &&
          currentAccount.data?.toLowerCase() === agentAddress.toLowerCase() &&
          funds.token.toLowerCase() === DEMO_USDC.toLowerCase() ? (
            <Link to={appRoutes.account} className="app-link">
              Fund your Vault
            </Link>
          ) : (
            <AddressLink address={funds.vault} chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
          )}
        </div>
      )}

      <section className="app-panel">
        <div className="app-panel-pad app-rule-summary space-y-2">
          <h2 className="app-overline">{mirror ? 'Mirror relationship' : 'Rule sentence'}</h2>
          <p className="break-words font-heading text-xl font-semibold text-ink">
            {mirror ? (
              <>
                {mirror.detached_at ? 'Detached from ' : 'Copies '}
                <Link
                  className="app-link"
                  to={`/rules/${mirror.leader_agent}/${mirror.leader_rule_id}`}
                >
                  leader rule #{mirror.leader_rule_id.toString()}
                </Link>
              </>
            ) : (
              <>“{ruleSentence(rule)}”</>
            )}
          </p>
          {mirror ? (
            <p className="app-copy">
              {mirror.scale_bps} bps ({mirror.scale_bps / 100}%) · {mirror.hourly_cap} trades per
              hour ·{' '}
              {rule.token_in
                ? signatureTokenAmount(rule.chain_id, rule.token_in, mirror.per_run_cap)
                : `${mirror.per_run_cap} base units`}{' '}
              per run
            </p>
          ) : null}
          {!mirror && rule.pair && PRICE_TEMPLATES.has(rule.template) ? (
            <CachedPrice agent={agentAddress} pair={rule.pair as Address} />
          ) : null}
        </div>
        <dl className="app-divider app-panel-pad grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="mb-1 text-xs text-ink-muted">Automation account</dt>
            <dd>
              <AddressLink chainId={LASNA_CHAIN_ID} address={agentAddress} />
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-xs text-ink-muted">Funds network</dt>
            <dd className="text-ink">
              <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-xs text-ink-muted">Rule type</dt>
            <dd className="text-ink">{getTemplate(rule.template)?.name ?? rule.template}</dd>
          </div>
          <div>
            <dt className="mb-1 text-xs text-ink-muted">Per-run amount</dt>
            <dd className="break-words text-ink">
              {rule.amount_in === undefined
                ? '—'
                : rule.token_in
                  ? signatureTokenAmount(rule.chain_id, rule.token_in, rule.amount_in)
                  : `${rule.amount_in} base units`}
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-xs text-ink-muted">Runs</dt>
            <dd className="app-number">{rule.runs}</dd>
          </div>
          <div>
            <dt className="mb-1 text-xs text-ink-muted">Last run</dt>
            <dd>{lastRunLabel(rule)}</dd>
          </div>
        </dl>
      </section>

      {successor ? (
        <p className="app-copy">
          Replaced by{' '}
          <Link to={`/rules/${agentAddress}/${successor}`} className="app-link">
            rule #{successor.toString()}
          </Link>
          .
        </p>
      ) : null}
      {rule.replaces !== undefined && (
        <p className="app-copy">
          Replaces{' '}
          <Link to={`/rules/${agentAddress}/${rule.replaces}`} className="app-link">
            rule #{rule.replaces.toString()}
          </Link>
          .
        </p>
      )}

      <BudgetAtRiskBanner sponsor={sponsor} canFund={isOwner} />
      <div className="app-detail-layout">
        <div className="app-page">
          <section aria-label="Execution history" className="app-panel">
            <h2 className="app-panel-heading app-panel-pad">
              {mirror ? 'Mirrored executions' : 'Executions'}
            </h2>
            <ExecutionTable
              executions={
                mirror
                  ? executions.filter((execution) => execution.kind === 'mirrored')
                  : executions
              }
            />
          </section>

          {isOwner && address && !terminal && (
            <TelegramNotifications
              agent={agentAddress}
              owner={address}
              ruleId={currentRuleId.toString()}
            />
          )}
          {(alerts.length > 0 || alertTemplateSchema.safeParse(rule.template).success) && (
            <section aria-label="Alerts" className="app-panel app-panel-pad space-y-3">
              <h2 className="app-panel-heading">Alerts</h2>
              {alerts.length === 0 ? (
                <p className="app-copy">
                  No alerts yet. An alert records activity and never moves funds.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-ink-muted">
                  {alerts.map((alert) => (
                    <li key={alert.tx_hash} className="flex flex-wrap items-center gap-2">
                      <span>alerted</span>
                      <span>
                        {new Date(alert.block_time).toISOString().replace('T', ' ').slice(0, 16)}{' '}
                        UTC
                      </span>
                      <TxLink chainId={LASNA_CHAIN_ID} txHash={alert.tx_hash} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
        <div className="app-page">
          <section aria-label="Rule actions" className="app-panel app-panel-pad space-y-3">
            <h2 className="app-panel-heading">Control</h2>
            {terminal ? (
              <p className="app-copy">This rule is retired. You can still view its executions.</p>
            ) : !isOwner ? (
              <p className="app-copy">Connect the owner wallet to manage this rule.</p>
            ) : mirror && !mirror.detached_at ? (
              <DetachMirror detach={() => control.detachMirror(currentRuleId)} />
            ) : (
              <>
                <RuleActions
                  ruleId={currentRuleId}
                  status={status}
                  onPause={() => control.pause(currentRuleId)}
                  onResume={() => control.resume(currentRuleId)}
                  onCancel={() => control.cancel(currentRuleId)}
                  onRearm={() => control.rearm(currentRuleId)}
                />
                {editable && (
                  <Link className="app-button" to="?edit=1">
                    Edit rule
                  </Link>
                )}
                {editCapability.isError && (
                  <p className="app-copy">Editing requires a newer automation account.</p>
                )}
              </>
            )}
          </section>

          {budget ? (
            <section aria-label="Execution budget">
              <BudgetMeter budget={budget} />
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type ChainRule = NonNullable<Awaited<ReturnType<typeof readRule>>>;

function readRule(agent: Address, id: bigint) {
  return lasnaPublicClient.readContract({
    address: agent,
    abi: agentAbi,
    functionName: 'getRule',
    args: [id],
  });
}

function EditRuleComposer({
  agent,
  ruleId,
  liveRule,
  sentence,
  onEdited,
}: {
  readonly agent: Address;
  readonly ruleId: bigint;
  readonly liveRule: ChainRule;
  readonly sentence: string;
  readonly onEdited: (nextId: bigint) => void;
}) {
  const vault = useReadContract({
    address: agent,
    abi: agentAbi,
    functionName: 'getVault',
    args: [BigInt(liveRule.chainId)],
    chainId: LASNA_CHAIN_ID,
  });
  const terms = useComposerVaultTerms(vault.data && vault.data !== ZERO ? vault.data : undefined);
  return (
    <>
      <p className="app-copy">Current rule “{sentence}”</p>
      <CreateRuleForm
        agent={agent}
        initialState={composerForRule(liveRule)}
        edit={{ ruleId, flags: liveRule.flags }}
        vaultTerms={terms.data}
        vaultPending={vault.isLoading || (!terms.data && terms.isFetching)}
        refreshVault={async () => {
          if (!vault.data || vault.data === ZERO) {
            await vault.refetch({ throwOnError: true });
            throw new Error('Link a vault before editing a rule that moves funds.');
          }
          const refreshed = await terms.refetch({ throwOnError: true });
          if (!refreshed.data) throw new Error('Vault settings are unavailable.');
          return refreshed.data;
        }}
        onEdited={onEdited}
      />
    </>
  );
}
