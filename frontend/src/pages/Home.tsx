import {
  agentAbi,
  agentFactoryAbi,
  LASNA_CHAIN_ID,
  type Address,
  type Rule,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAccount, useReadContract } from 'wagmi';

import { BudgetAtRiskBanner, worstSponsorState } from '../components/BudgetAtRiskBanner.js';
import { ErrorState } from '../components/ErrorState.js';
import { StatusPill, type RuleStatus } from '../components/StatusPill.js';
import { api } from '../lib/api.js';
import { AGENT_FACTORY_ADDRESS } from '../lib/contracts.js';
import { appRoutes } from '../lib/routes.js';
import { lastRunLabel, ruleSentence } from '../lib/rules.js';

const ZERO = '0x0000000000000000000000000000000000000000';

function statusOf(rule: Rule): RuleStatus {
  if (rule.latched && rule.status === 'active') return 'latched';
  return rule.status;
}

function RuleRow({ rule, agent }: { readonly rule: Rule; readonly agent: Address }) {
  const ruleId = rule.rule_id.toString();
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">#{ruleId}</span>
          <StatusPill status={statusOf(rule)} />
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
            {rule.template}
          </span>
        </div>
        <p className="text-sm text-ink">“{ruleSentence(rule)}”</p>
        <dl className="flex flex-wrap gap-4 text-xs text-ink-muted">
          <div className="flex gap-1">
            <dt>Runs</dt>
            <dd className="text-ink">{rule.runs}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Last run</dt>
            <dd className="text-ink">{lastRunLabel(rule)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Remaining budget</dt>
            <dd className="text-ink">
              {rule.status === 'active' ? 'operator-sponsored' : 'not running'}
            </dd>
          </div>
        </dl>
      </div>
      <Link
        to={`/rules/${agent}/${ruleId}`}
        className="self-start rounded-full border border-border px-3 py-1 text-xs text-ink sm:self-center"
      >
        Detail
      </Link>
    </li>
  );
}

/** `/rules`: every rule for the connected account, in the Agent's evaluation order. */
export function Home() {
  const { address } = useAccount();
  const owner = (address?.toLowerCase() as Address | undefined) ?? ZERO;

  const agentQuery = useReadContract({
    address: AGENT_FACTORY_ADDRESS ?? ZERO,
    abi: agentFactoryAbi,
    functionName: 'agentOf',
    args: [owner],
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(address && AGENT_FACTORY_ADDRESS) },
  });
  const agent = agentQuery.data && agentQuery.data !== ZERO ? agentQuery.data : null;

  const orderQuery = useReadContract({
    address: agent ?? ZERO,
    abi: agentAbi,
    functionName: 'getRuleIds',
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(agent) },
  });

  const rulesQuery = useQuery({
    // Distinct from RuleDetail's `['rules', agent]`: this query caches the feed envelope, not
    // the bare rule array. Both share the prefix so control/clone invalidation still covers them.
    queryKey: ['rules', agent, 'feed'],
    queryFn: () => api.rulesFeed(agent as string, 'all'),
    enabled: Boolean(agent),
  });

  const sponsorQuery = useQuery({
    queryKey: ['sponsor', agent],
    queryFn: () => api.sponsor(agent as string),
    enabled: Boolean(agent),
    retry: false,
  });

  if (!address) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold text-ink">Your rules</h1>
        <p className="text-ink-muted">Connect a wallet to see the rules it owns.</p>
      </section>
    );
  }

  if (agentQuery.isLoading || (agent && rulesQuery.isLoading)) {
    return (
      <section aria-busy="true" className="space-y-3">
        <h1 className="text-2xl font-semibold text-ink">Your rules</h1>
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-lg border border-border bg-surface-raised"
            />
          ))}
        </div>
      </section>
    );
  }

  if (rulesQuery.error) {
    return (
      <ErrorState
        message="Rules could not be loaded from the indexer."
        detail={rulesQuery.error instanceof Error ? rulesQuery.error.message : null}
        chainId={LASNA_CHAIN_ID}
      />
    );
  }

  if (!agent) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold text-ink">Your rules</h1>
        <p className="text-ink-muted">You do not have an automation account yet.</p>
        <Link to={appRoutes.account} className="text-sm text-automation underline">
          Create your account
        </Link>
      </section>
    );
  }

  const order = orderQuery.data ?? [];
  const alerts = rulesQuery.data?.alerts ?? [];
  const rules = (rulesQuery.data?.rules ?? []).slice().sort((left, right) => {
    const leftIndex = order.findIndex((id) => id === left.rule_id);
    const rightIndex = order.findIndex((id) => id === right.rule_id);
    return (
      (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
    );
  });

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-ink">Your rules</h1>
          <p className="text-sm text-ink-muted">
            Evaluated top to bottom, in the order shown. Only you can pause, cancel, or withdraw.
          </p>
        </div>
        <Link
          to={appRoutes.create}
          className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface"
        >
          Assemble new rule
        </Link>
      </header>

      <BudgetAtRiskBanner state={worstSponsorState(sponsorQuery.data)} agent={agent ?? undefined} />

      {rules.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-ink">No rules yet.</p>
          <p className="text-xs text-ink-muted">
            Build one from a sentence: pick a rule type, fill the blanks, sign once.
          </p>
          <Link to={appRoutes.create} className="text-sm text-automation underline">
            Compose your first rule
          </Link>
        </div>
      ) : (
        <ol aria-label="Rules in evaluation order" className="space-y-3">
          {rules.map((rule) => (
            <RuleRow key={`${rule.agent}-${rule.rule_id}`} rule={rule} agent={agent} />
          ))}
        </ol>
      )}

      {alerts.length > 0 ? (
        <section aria-label="Alerts" className="space-y-2">
          <h2 className="text-base font-semibold text-ink">Alerts</h2>
          <p className="text-xs text-ink-muted">
            Alerts are activity records from your rules. They never move funds.
          </p>
          <ul className="space-y-1 text-xs text-ink-muted">
            {alerts.map((alert) => (
              <li key={alert.tx_hash} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-ink">#{alert.rule_id}</span>
                <span>alerted</span>
                <span>
                  {new Date(alert.block_time).toISOString().replace('T', ' ').slice(0, 16)} UTC
                </span>
                <span className="font-mono text-[11px] text-ink-muted">
                  {alert.tx_hash.slice(0, 10)}…
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
