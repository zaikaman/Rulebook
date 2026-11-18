import { ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  agentAbi,
  getTemplate,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAccount, useReadContract } from 'wagmi';

import { AddressLink } from '../components/AddressLink.js';
import { BudgetAtRiskBanner, worstSponsorState } from '../components/BudgetAtRiskBanner.js';
import { BudgetMeter } from '../components/BudgetMeter.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { ExecutionTable } from '../components/ExecutionTable.js';
import { DetachMirror } from '../components/MirrorForm.js';
import { NetworkBadge } from '../components/NetworkBadge.js';
import { PriceLabel } from '../components/PriceLabel.js';
import { TxLink } from '../components/TxLink.js';
import { RuleActions } from '../components/RuleActions.js';
import { RuleOrderList } from '../components/RuleOrderList.js';
import { StatusPill, type RuleStatus } from '../components/StatusPill.js';
import { useRuleControl } from '../hooks/useRuleControl.js';
import { api } from '../lib/api.js';
import { appRoutes } from '../lib/routes.js';
import { lastRunLabel, ruleSentence } from '../lib/rules.js';
import { signatureTokenAmount } from '../lib/signatures.js';

const ZERO = '0x0000000000000000000000000000000000000000';
/** Templates whose condition reads a cached pair price. */
const PRICE_TEMPLATES = new Set([1, 2, 3, 4, 5, 6, 11, 12]);

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

function statusOf(status: 'active' | 'paused' | 'cancelled', latched: boolean): RuleStatus {
  if (latched && status === 'active') return 'latched';
  return status;
}

/** `/rules/:agent/:ruleId`: the sentence, its parameters, and the execution history. */
export function RuleDetail() {
  const { agent, ruleId } = useParams();
  const { address } = useAccount();
  const detailQuery = useQuery({
    queryKey: ['rule', agent, ruleId],
    queryFn: () => api.ruleDetail(agent as string, ruleId as string),
    enabled: Boolean(agent && ruleId),
    retry: false,
  });

  const rulesQuery = useQuery({
    queryKey: ['rules', agent],
    queryFn: () => api.rules(agent as string, 'all'),
    enabled: Boolean(agent),
  });

  const orderQuery = useReadContract({
    address: (agent as Address | undefined) ?? ZERO,
    abi: agentAbi,
    functionName: 'getRuleIds',
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(agent) },
  });
  const ownerQuery = useReadContract({
    address: (agent as Address | undefined) ?? ZERO,
    abi: agentAbi,
    functionName: 'owner',
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(address && agent && detailQuery.data?.mirror) },
  });

  const control = useRuleControl((agent as Address | undefined) ?? null);

  const breadcrumb = (
    <>
      <Link to={appRoutes.rules}>Your rules</Link>
      <HugeiconsIcon icon={ArrowRight02Icon} size={12} aria-hidden="true" />
      <span aria-current="page">Detail</span>
    </>
  );

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
        />
      </section>
    );
  }

  const { rule, recent_executions: executions, budget, sponsor, mirror } = detailQuery.data;
  const alerts = detailQuery.data.alerts ?? [];
  const agentAddress = agent as Address;
  const rules = rulesQuery.data ?? [];
  const order = orderQuery.data ?? rules.map((candidate) => candidate.rule_id);
  const labels = Object.fromEntries(
    rules.map((candidate) => [candidate.rule_id.toString(), ruleSentence(candidate)]),
  );
  const currentRuleId = rule.rule_id;

  return (
    <section className="app-page">
      <PageHeading
        title={`Rule #${currentRuleId.toString()}`}
        breadcrumb={breadcrumb}
        aside={<StatusPill status={statusOf(rule.status, rule.latched)} />}
      />

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

      <BudgetAtRiskBanner state={worstSponsorState(sponsor)} agent={agentAddress} />
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
                      {new Date(alert.block_time).toISOString().replace('T', ' ').slice(0, 16)} UTC
                    </span>
                    <TxLink chainId={LASNA_CHAIN_ID} txHash={alert.tx_hash} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="app-page">
          <section aria-label="Rule actions" className="app-panel app-panel-pad space-y-3">
            <h2 className="app-panel-heading">Control</h2>
            {mirror && !mirror.detached_at ? (
              address && ownerQuery.data?.toLowerCase() === address.toLowerCase() ? (
                <DetachMirror detach={() => control.detachMirror(currentRuleId)} />
              ) : (
                <p className="app-copy">Connect the owner wallet to detach this mirror.</p>
              )
            ) : (
              <RuleActions
                ruleId={currentRuleId}
                status={statusOf(rule.status, rule.latched)}
                onPause={() => control.pause(currentRuleId)}
                onResume={() => control.resume(currentRuleId)}
                onCancel={() => control.cancel(currentRuleId)}
              />
            )}
          </section>

          {budget ? (
            <section aria-label="Execution budget">
              <BudgetMeter budget={budget} />
            </section>
          ) : null}
        </div>
      </div>

      <section aria-label="Evaluation order" className="app-panel app-panel-pad space-y-3">
        <h2 className="app-panel-heading">Evaluation order</h2>
        <p className="app-copy">
          Rules run top to bottom on every wake-up. Move one to change which gets the gas first.
        </p>
        <RuleOrderList ids={order} labels={labels} onReorder={control.reorder} />
      </section>
    </section>
  );
}
