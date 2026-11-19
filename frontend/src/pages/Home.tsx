import { Add01Icon, ArrowRight02Icon, Book02Icon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  agentAbi,
  agentFactoryAbi,
  getTemplate,
  LASNA_CHAIN_ID,
  type Address,
  type Rule,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAccount, useReadContract } from 'wagmi';

import { BudgetAtRiskBanner } from '../components/BudgetAtRiskBanner.js';
import { EmptyState } from '../components/chrome/EmptyState.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
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
    <li className="app-panel-pad flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">#{ruleId}</span>
          <StatusPill status={statusOf(rule)} />
          <span className="app-tag">
            {getTemplate(rule.template)?.name ?? `Template ${rule.template}`}
          </span>
        </div>
        <p className="break-words font-heading text-base font-semibold text-ink">
          “{ruleSentence(rule)}”
        </p>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
          <div className="flex gap-1">
            <dt>Runs</dt>
            <dd className="text-ink">{rule.runs}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Last run</dt>
            <dd className="text-ink">{lastRunLabel(rule)}</dd>
          </div>
        </dl>
      </div>
      <Link to={`/rules/${agent}/${ruleId}`} className="app-button self-start sm:self-center">
        Detail
        <HugeiconsIcon icon={ArrowRight02Icon} size={15} aria-hidden="true" />
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
      <section className="app-page">
        <PageHeading
          title="Your rules"
          description="Manage the automations owned by your wallet."
        />
        <EmptyState
          icon={Wallet01Icon}
          title="Connect a wallet"
          description="Use Connect wallet in the navigation to see the rules it owns."
        />
      </section>
    );
  }

  if (agentQuery.isLoading || (agent && rulesQuery.isLoading)) {
    return (
      <section aria-busy="true" className="app-page">
        <PageHeading
          title="Your rules"
          description="Manage the automations owned by your wallet."
        />
        <span role="status" className="sr-only">
          Loading rules
        </span>
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="app-skeleton h-24 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if ((!agent && agentQuery.error) || rulesQuery.error) {
    const error = agentQuery.error ?? rulesQuery.error;
    return (
      <section className="app-page">
        <PageHeading title="Your rules" />
        <ErrorState
          message={
            agentQuery.error
              ? 'Your automation account could not be loaded.'
              : 'Rules could not be loaded from the indexer.'
          }
          detail={error instanceof Error ? error.message : null}
          chainId={LASNA_CHAIN_ID}
          onRetry={() => void (agentQuery.error ? agentQuery.refetch() : rulesQuery.refetch())}
        />
      </section>
    );
  }

  if (!agent) {
    return (
      <section className="app-page">
        <PageHeading
          title="Your rules"
          description="Manage the automations owned by your wallet."
        />
        <EmptyState
          icon={Wallet01Icon}
          title="Set up your automation account"
          description="Create an account for this wallet before you compose your first rule."
          action={
            <Link to={appRoutes.account} className="app-button app-button--primary">
              Create your account
            </Link>
          }
        />
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
    <section className="app-page">
      <PageHeading
        title="Your rules"
        description={
          rules.length
            ? 'Your Agent evaluates rules from top to bottom, in the order shown.'
            : 'Compose and manage automations owned by your wallet.'
        }
        aside={
          rules.length ? (
            <Link to={appRoutes.create} className="app-button app-button--primary">
              <HugeiconsIcon icon={Add01Icon} size={17} aria-hidden="true" />
              Compose a rule
            </Link>
          ) : null
        }
      />

      {rules.length > 0 && <BudgetAtRiskBanner sponsor={sponsorQuery.data} />}

      {rules.length === 0 ? (
        <div className="app-panel app-rule-start">
          <EmptyState
            icon={Book02Icon}
            title="No rules yet"
            description="Choose a rule type, fill in the sentence, and sign once to add the automation to your account."
            action={
              <Link to={appRoutes.create} className="app-button app-button--primary">
                Compose your first rule
                <HugeiconsIcon icon={ArrowRight02Icon} size={17} aria-hidden="true" />
              </Link>
            }
          />
          <figure className="app-rule-example">
            <figcaption>Example rule</figcaption>
            <blockquote>
              Every <strong>day</strong>, buy <strong>10 USDC</strong>{' '}
              <span className="whitespace-nowrap">
                worth of <strong>WETH</strong>.
              </span>
            </blockquote>
          </figure>
        </div>
      ) : (
        <ol aria-label="Rules in evaluation order" className="app-panel app-rules-list">
          {rules.map((rule) => (
            <RuleRow key={`${rule.agent}-${rule.rule_id}`} rule={rule} agent={agent} />
          ))}
        </ol>
      )}

      {rules.length === 0 && <BudgetAtRiskBanner sponsor={sponsorQuery.data} beforeFirstRule />}

      {alerts.length > 0 ? (
        <section aria-label="Alerts" className="app-panel app-panel-pad space-y-3">
          <h2 className="app-panel-heading">Alerts</h2>
          <p className="app-copy">
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
