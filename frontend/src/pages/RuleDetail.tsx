import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID, type Address } from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { AddressLink } from '../components/AddressLink.js';
import { ErrorState } from '../components/ErrorState.js';
import { ExecutionTable } from '../components/ExecutionTable.js';
import { StatusPill, type RuleStatus } from '../components/StatusPill.js';
import { api } from '../lib/api.js';
import { appRoutes } from '../lib/routes.js';
import { lastRunLabel, ruleSentence } from '../lib/rules.js';

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

  const { rule, recent_executions: executions } = detailQuery.data;
  const agentAddress = agent as Address;

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

      <section aria-label="Rule actions" className="rounded-lg border border-dashed border-border p-4 text-xs text-ink-muted">
        Pause, resume, cancel, and reorder land with the control phase. Until then, the rule keeps
        the values above.
      </section>
    </section>
  );
}
