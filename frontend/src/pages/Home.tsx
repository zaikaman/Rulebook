import { Add01Icon, ArrowRight02Icon, Book02Icon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
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
import { RuleOrderList } from '../components/RuleOrderList.js';
import { StatusPill } from '../components/StatusPill.js';
import { useEvaluationOrder } from '../hooks/useEvaluationOrder.js';
import { useRuleControl } from '../hooks/useRuleControl.js';
import { useRuleFunds } from '../hooks/useRuleFunds.js';
import { api } from '../lib/api.js';
import { AGENT_FACTORY_ADDRESS } from '../lib/contracts.js';
import { appRoutes } from '../lib/routes.js';
import { lastRunLabel, ruleLifecycle, ruleSentence, RULE_FLAGS } from '../lib/rules.js';

const ZERO = '0x0000000000000000000000000000000000000000';

function RuleRow({
  rule,
  agent,
  flags,
}: {
  readonly rule: Rule;
  readonly agent: Address;
  readonly flags: number | undefined;
}) {
  const ruleId = rule.rule_id.toString();
  const lifecycle = ruleLifecycle(rule, flags);
  const funds = useRuleFunds(
    agent,
    rule,
    lifecycle === 'active' && flags !== undefined && (flags & RULE_FLAGS.mirrored) === 0,
  );
  return (
    <li className="app-panel-pad flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">#{ruleId}</span>
          <StatusPill
            status={
              rule.replaced_by !== undefined ? 'replaced' : funds ? 'waiting-funds' : lifecycle
            }
          />
          <span className="app-tag">
            {getTemplate(rule.template)?.name ?? `Template ${rule.template}`}
          </span>
        </div>
        <p className="break-words font-heading text-base font-semibold text-ink">
          “{ruleSentence(rule)}”
        </p>
        {funds && (
          <p className="app-copy text-sm">
            {funds.available} available · {funds.required} needed per run
          </p>
        )}
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

/** `/rules`: account rules, evaluation priority, and retired rules. */
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

  const rulesQuery = useQuery({
    // Distinct from RuleDetail's `['rules', agent]`: this query caches the feed envelope, not
    // the bare rule array. Both share the prefix so control/clone invalidation still covers them.
    queryKey: ['rules', agent?.toLowerCase(), 'feed'],
    queryFn: () => api.rulesFeed(agent as string, 'all'),
    enabled: Boolean(agent),
  });
  const indexedRules = rulesQuery.data?.rules ?? [];
  const orderQuery = useEvaluationOrder(agent, indexedRules);
  const control = useRuleControl(agent);

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

  const accountError = agentQuery.error;
  if ((!agent && accountError) || rulesQuery.error) {
    const error = accountError ?? rulesQuery.error;
    return (
      <section className="app-page">
        <PageHeading title="Your rules" />
        <ErrorState
          message={
            accountError
              ? 'Your automation account could not be loaded.'
              : 'Rules could not be loaded from the indexer.'
          }
          detail={error instanceof Error ? error.message : null}
          chainId={LASNA_CHAIN_ID}
          onRetry={() => void (accountError ? agentQuery.refetch() : rulesQuery.refetch())}
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

  const order = orderQuery.data;
  const alerts = rulesQuery.data?.alerts ?? [];
  const positions = new Map(order?.ids.map((id, index) => [id, index]));
  const rules = indexedRules
    .filter((rule) => ruleLifecycle(rule, order?.flags.get(rule.rule_id)) !== 'cancelled')
    .sort(
      (left, right) =>
        (positions.get(left.rule_id) ?? Infinity) - (positions.get(right.rule_id) ?? Infinity),
    );
  const history = indexedRules
    .filter((rule) => ruleLifecycle(rule, order?.flags.get(rule.rule_id)) === 'cancelled')
    .sort((left, right) => (left.rule_id > right.rule_id ? -1 : 1));
  const labels = Object.fromEntries(
    rules.map((rule) => [rule.rule_id.toString(), ruleSentence(rule)]),
  );
  const hasRules = indexedRules.length > 0 || (order?.ids.length ?? 0) > 0;
  const row = (rule: Rule) => (
    <RuleRow
      key={rule.rule_id.toString()}
      rule={rule}
      agent={agent}
      flags={order?.flags.get(rule.rule_id)}
    />
  );

  return (
    <section className="app-page">
      <PageHeading
        title="Your rules"
        description="Manage the automations owned by your wallet."
        aside={
          hasRules ? (
            <Link to={appRoutes.create} className="app-button app-button--primary">
              <HugeiconsIcon icon={Add01Icon} size={17} aria-hidden="true" />
              Compose a rule
            </Link>
          ) : null
        }
      />

      {hasRules && <BudgetAtRiskBanner sponsor={sponsorQuery.data} />}

      {!hasRules ? (
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
      ) : rules.length ? (
        <ol aria-label="Current rules" className="app-panel app-rules-list">
          {rules.map(row)}
        </ol>
      ) : (
        <p className="app-copy">
          {order?.ids.length
            ? 'Confirmed rule details are syncing.'
            : 'You have no active or paused rules.'}
        </p>
      )}

      {!hasRules && <BudgetAtRiskBanner sponsor={sponsorQuery.data} beforeFirstRule />}

      {hasRules && (
        <section
          aria-labelledby="evaluation-order-heading"
          className="app-panel app-panel-pad space-y-3"
        >
          <h2 id="evaluation-order-heading" className="app-panel-heading">
            Evaluation order
          </h2>
          {orderQuery.isError ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="app-copy" role="status">
                The on-chain order is unavailable.
              </p>
              <button
                type="button"
                className="app-button"
                onClick={() => void orderQuery.refetch()}
              >
                Retry
              </button>
            </div>
          ) : !order ? (
            <p className="app-copy" role="status">
              Loading the on-chain order…
            </p>
          ) : order.ids.length === 0 ? (
            <p className="app-copy">No rules are enabled for evaluation.</p>
          ) : (
            <>
              <p className="app-copy">Your Agent checks enabled rules from top to bottom.</p>
              <RuleOrderList
                ids={order.ids}
                labels={labels}
                onReorder={(ids) => control.reorder(ids, order, indexedRules)}
              />
            </>
          )}
        </section>
      )}

      {history.length > 0 && (
        <details className="app-panel">
          <summary className="app-panel-pad cursor-pointer font-semibold">
            History ({history.length})
          </summary>
          <ol aria-label="Retired rules" className="app-divider app-rules-list">
            {history.map(row)}
          </ol>
        </details>
      )}

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
