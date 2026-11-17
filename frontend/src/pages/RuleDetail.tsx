import {
  agentAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useReadContract } from 'wagmi';

import { AddressLink } from '../components/AddressLink.js';
import { BudgetAtRiskBanner, worstSponsorState } from '../components/BudgetAtRiskBanner.js';
import { BudgetMeter } from '../components/BudgetMeter.js';
import { ErrorState } from '../components/ErrorState.js';
import { ExecutionTable } from '../components/ExecutionTable.js';
import { RuleActions } from '../components/RuleActions.js';
import { RuleOrderList } from '../components/RuleOrderList.js';
import { StatusPill, type RuleStatus } from '../components/StatusPill.js';
import { useRuleControl } from '../hooks/useRuleControl.js';
import { api } from '../lib/api.js';
import { appRoutes } from '../lib/routes.js';
import { lastRunLabel, ruleSentence } from '../lib/rules.js';

const ZERO = '0x0000000000000000000000000000000000000000';

function statusOf(status: 'active' | 'paused' | 'cancelled', latched: boolean): RuleStatus {
  if (latched && status === 'active') return 'latched';
  return status;
}

/** `/rules/:agent/:ruleId`: the sentence, its parameters, and the execution history. */
export function RuleDetail() {
  const { agent, ruleId } = useParams();
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

  const control = useRuleControl((agent as Address | undefined) ?? null);

  const backLink = (
    <Link to={appRoutes.rules} className="text-xs text-ink-muted hover:text-ink">
      ← Back to all rules
    </Link>
  );

  if (detailQuery.isLoading) {
    return (
      <section aria-busy="true" className="space-y-4">
        {backLink}
        <div className="h-40 animate-pulse rounded-lg border border-border bg-surface-raised" />
        <div className="h-24 animate-pulse rounded-lg border border-border bg-surface-raised" />
      </section>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <section className="space-y-4">
        {backLink}
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

  const { rule, recent_executions: executions, budget, sponsor } = detailQuery.data;
  const agentAddress = agent as Address;
  const rules = rulesQuery.data ?? [];
  const order = orderQuery.data ?? rules.map((candidate) => candidate.rule_id);
  const labels = Object.fromEntries(
    rules.map((candidate) => [candidate.rule_id.toString(), ruleSentence(candidate)]),
  );
  const currentRuleId = rule.rule_id;

  return (
    <section className="space-y-6">
      {backLink}

      <header className="space-y-3 rounded-lg border border-border bg-surface-raised p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">#{rule.rule_id.toString()}</span>
          <StatusPill status={statusOf(rule.status, rule.latched)} />
          <span className="text-xs text-ink-muted">{rule.runs} runs</span>
          <span className="text-xs text-ink-muted">Last run: {lastRunLabel(rule)}</span>
        </div>
        <p className="text-xl text-ink">“{ruleSentence(rule)}”</p>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">Automation account (Lasna)</dt>
            <dd>
              <AddressLink chainId={LASNA_CHAIN_ID} address={agentAddress} />
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Funds network</dt>
            <dd className="text-ink">
              Unichain Sepolia ({UNICHAIN_SEPOLIA_CHAIN_ID}) holds the principal
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Template</dt>
            <dd className="text-ink">{rule.template}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Per-run amount</dt>
            <dd className="text-ink">{rule.amount_in?.toString() ?? '—'} (base units)</dd>
          </div>
        </dl>
      </header>

      <section aria-label="Execution history" className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Executions</h2>
        <ExecutionTable executions={executions} />
      </section>

      <BudgetAtRiskBanner state={worstSponsorState(sponsor)} agent={agentAddress} />

      {budget ? (
        <section aria-label="Execution budget">
          <BudgetMeter budget={budget} />
        </section>
      ) : null}

      <section aria-label="Rule actions" className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Control</h2>
        <RuleActions
          ruleId={currentRuleId}
          status={statusOf(rule.status, rule.latched)}
          onPause={() => control.pause(currentRuleId)}
          onResume={() => control.resume(currentRuleId)}
          onCancel={() => control.cancel(currentRuleId)}
        />
      </section>

      <section aria-label="Evaluation order" className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Evaluation order</h2>
        <p className="text-xs text-ink-muted">
          Rules run top to bottom on every wake-up. Move one to change which gets the gas first.
        </p>
        <RuleOrderList ids={order} labels={labels} onReorder={control.reorder} />
      </section>
    </section>
  );
}
