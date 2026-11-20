import {
  ArrowRight02Icon,
  Calendar03Icon,
  FlashIcon,
  SecurityCheckIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { Link } from 'react-router';

import { NetworkBadge } from '../components/NetworkBadge.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { costModel, type AnnualScenario, type FeeFigure, type RateRow } from '../lib/costModel.js';
import { appRoutes } from '../lib/routes.js';

interface Responsibility {
  readonly activity: string;
  readonly payer: string;
  readonly role?: 'automation' | 'funds';
  readonly detail: string;
}

const RESPONSIBILITIES: readonly Responsibility[] = [
  {
    activity: 'Account deployment',
    payer: 'Your wallet',
    detail: 'Pays the network fees to create and link your accounts.',
  },
  {
    activity: 'Rule evaluation',
    payer: `Your ${costModel.networks.automation.reserve}`,
    role: 'automation',
    detail: 'Pays for every wake-up that checks whether a rule should run.',
  },
  {
    activity: 'Automated execution',
    payer: `Your ${costModel.networks.funds.reserve}`,
    role: 'funds',
    detail: 'Pays the callback fee when your vault carries out an authorized action.',
  },
  {
    activity: 'Trading principal',
    payer: 'You',
    detail: 'Only the funds you allocate to your vault are available for trades.',
  },
  {
    activity: 'Direct wallet transactions',
    payer: 'Your wallet',
    detail: 'Transactions your wallet submits, such as withdrawals, show their fee in your wallet.',
  },
];

const numberFormat = new Intl.NumberFormat('en-US');

const measuredLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${costModel.measuredOn}T00:00:00Z`));

const annualMax = Math.max(
  ...costModel.annual.schedule.map((scenario) => scenario.reactPerYear),
  ...costModel.annual.price.map((scenario) => scenario.reactPerYear),
);

function Figure({ figure }: { readonly figure: FeeFigure }) {
  return (
    <span className="app-cost-figure">
      <span className="app-cost-figure-amount">{figure.amount}</span>{' '}
      <span className="app-cost-figure-unit">{figure.unit}</span>
    </span>
  );
}

function FeeLane({
  chainId,
  role,
  icon,
  title,
  copy,
}: {
  readonly chainId: number;
  readonly role: 'automation' | 'funds';
  readonly icon: IconSvgElement;
  readonly title: string;
  readonly copy: string;
}) {
  const network = costModel.networks[role];

  return (
    <article className="app-cost-lane" data-chain-role={role}>
      <header className="app-cost-lane-head">
        <span className="app-icon app-cost-lane-icon">
          <HugeiconsIcon icon={icon} size={19} aria-hidden="true" />
        </span>
        <div className="app-cost-lane-identity">
          <h3 className="app-cost-lane-title">{title}</h3>
          <NetworkBadge chainId={chainId} />
        </div>
      </header>
      <p className="app-cost-lane-copy">{copy}</p>
      <dl className="app-cost-lane-meta">
        <div>
          <dt>Observed base fee</dt>
          <dd>
            <Figure figure={network.baseFee} />
          </dd>
        </div>
        <div>
          <dt>Fee currency</dt>
          <dd className="app-cost-lane-token">{network.feeToken}</dd>
        </div>
      </dl>
    </article>
  );
}

function RateTable({
  networkName,
  rows,
}: {
  readonly networkName: string;
  readonly rows: readonly RateRow[];
}) {
  return (
    <table className="app-cost-rate-table">
      <caption className="sr-only">{networkName} call costs</caption>
      <thead>
        <tr>
          <th scope="col">Operation</th>
          <th scope="col">Estimated cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.operation}-${row.trigger}`}>
            <th scope="row">
              <span className="app-cost-rate-operation">{row.operation}</span>
              <span className="app-cost-rate-trigger">{row.trigger}</span>
            </th>
            <td>
              <Figure figure={row.cost} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScenarioList({
  title,
  scenarios,
}: {
  readonly title: string;
  readonly scenarios: readonly AnnualScenario[];
}) {
  const ordered = scenarios.slice().sort((left, right) => left.reactPerYear - right.reactPerYear);

  return (
    <section className="app-cost-group" aria-label={title}>
      <h3 className="app-cost-group-label">{title}</h3>
      <ul className="app-cost-scenarios">
        {ordered.map((scenario) => (
          <li key={`${scenario.label}-${scenario.detail}`} className="app-cost-scenario">
            <span className="app-cost-scenario-label">{scenario.label}</span>
            <span className="app-cost-scenario-detail">{scenario.detail}</span>
            <span className="app-cost-scenario-value">
              {numberFormat.format(scenario.reactPerYear)}
              <span> REACT / yr</span>
            </span>
            <span className="app-cost-bar" aria-hidden="true">
              <span style={{ width: `${(scenario.reactPerYear / annualMax) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Cost() {
  return (
    <section className="app-page app-cost">
      <PageHeading
        eyebrow="Economics"
        title="Cost & custody model"
        description="See what it costs to run a rule and where your funds are held."
        aside={
          <span className="app-cost-measured">
            <HugeiconsIcon icon={Calendar03Icon} size={14} aria-hidden="true" />
            Base fees measured <time dateTime={costModel.measuredOn}>{measuredLabel}</time>
          </span>
        }
      />

      <section className="app-panel app-cost-flow" aria-labelledby="cost-flow">
        <div className="app-cost-panel-head">
          <h2 id="cost-flow" className="app-panel-heading">
            Two chains, two fees
          </h2>
        </div>
        <div className="app-cost-lanes">
          <FeeLane
            chainId={LASNA_CHAIN_ID}
            role="automation"
            icon={FlashIcon}
            title="Evaluates your rules"
            copy="Wakes on a schedule or a price event, then checks whether any rule should run."
          />
          <FeeLane
            chainId={UNICHAIN_SEPOLIA_CHAIN_ID}
            role="funds"
            icon={Wallet01Icon}
            title="Carries out approved actions"
            copy="Receives the callback and executes the swap or transfer that a rule allows."
          />
        </div>
      </section>

      <section className="app-panel app-cost-duty" aria-labelledby="cost-duty">
        <div className="app-cost-panel-head">
          <h2 id="cost-duty" className="app-panel-heading">
            Who pays for what
          </h2>
          <p className="app-copy">
            Fees come from the balance on the network that does the work. Trading principal is held
            separately.
          </p>
        </div>
        <div className="app-cost-duty-labels" aria-hidden="true">
          <span>Activity</span>
          <span>Paid by</span>
          <span>What it covers</span>
        </div>
        <dl className="app-cost-duty-list">
          {RESPONSIBILITIES.map(({ activity, payer, role, detail }) => (
            <div key={activity} className="app-cost-duty-row">
              <dt className="app-cost-duty-activity">{activity}</dt>
              <dd className="app-cost-duty-payer" data-chain-role={role}>
                {role ? <span className="app-cost-payer-dot" aria-hidden="true" /> : null}
                {payer}
              </dd>
              <dd className="app-cost-duty-detail">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="app-panel app-cost-rates" aria-labelledby="cost-rates">
        <div className="app-cost-panel-head">
          <h2 id="cost-rates" className="app-panel-heading">
            What a call costs
          </h2>
          <p className="app-copy">
            These estimates use the measured base fees and change with gas prices. A Lasna wake-up
            can incur a fee even when no rule runs.
          </p>
        </div>
        <div className="app-cost-rate-groups">
          <div className="app-cost-rate-group">
            <div className="app-cost-rate-head">
              <NetworkBadge chainId={LASNA_CHAIN_ID} />
              <p>Paid from your {costModel.networks.automation.reserve}</p>
            </div>
            <RateTable networkName="Reactive Lasna" rows={costModel.rates.automation} />
          </div>
          <div className="app-cost-rate-group">
            <div className="app-cost-rate-head">
              <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
              <p>Paid from your {costModel.networks.funds.reserve}</p>
            </div>
            <RateTable networkName="Unichain Sepolia" rows={costModel.rates.funds} />
          </div>
        </div>
      </section>

      <aside className="app-panel app-cost-custody" aria-labelledby="cost-custody">
        <span className="app-icon app-cost-custody-icon">
          <HugeiconsIcon icon={SecurityCheckIcon} size={20} aria-hidden="true" />
        </span>
        <div className="app-cost-custody-copy">
          <h2 id="cost-custody" className="app-panel-heading">
            Your wallet owns the vault
          </h2>
          <p className="app-copy">
            Only your wallet can withdraw the funds you deposit. Rules can act only inside the
            limits you set.
          </p>
        </div>
        <Link to={appRoutes.account} className="app-cost-custody-link">
          View your vault
          <HugeiconsIcon icon={ArrowRight02Icon} size={15} aria-hidden="true" />
        </Link>
      </aside>

      <section className="app-panel app-cost-annual" aria-labelledby="cost-annual">
        <div className="app-cost-panel-head">
          <h2 id="cost-annual" className="app-panel-heading">
            Planning a year
          </h2>
          <p className="app-copy">
            Estimated Lasna monitoring costs in REACT per year. Faster schedule checks are shown for
            comparison. Both groups use the same scale.
          </p>
        </div>
        <div className="app-cost-annual-groups">
          <ScenarioList title="Scheduled rules" scenarios={costModel.annual.schedule} />
          <ScenarioList title="Price-triggered rules" scenarios={costModel.annual.price} />
        </div>
        <p className="app-cost-insight">
          Weekly and daily rules on the same tick interval cost about the same because the Agent
          wakes on every tick. Price rule estimates use the rate for events that trigger no action.
          These estimates exclude Unichain callback fees and one-time setup.
        </p>
      </section>
    </section>
  );
}
