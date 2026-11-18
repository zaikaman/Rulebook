import { Coins01Icon, SecurityCheckIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from 'react-router';

import { PageHeading } from '../components/chrome/PageHeading.js';
import { costModel } from '../lib/costModel.js';
import { appRoutes } from '../lib/routes.js';

const COSTS = [
  {
    activity: 'Account deployment',
    payer: 'Operator',
    detail: 'Deploys your Automation Agent and Vault contracts.',
  },
  {
    activity: 'Rule evaluation',
    payer: 'Operator',
    detail: 'Funds the Reactive Lasna credit used to watch events and evaluate rules.',
  },
  {
    activity: 'Automated execution',
    payer: 'Operator',
    detail: 'Funds the destination gas when your vault executes an authorized action.',
  },
  {
    activity: 'Trading principal',
    payer: 'You',
    detail: 'Only the funds you allocate to your vault are available for trades.',
  },
  {
    activity: 'Direct wallet transactions',
    payer: 'Your wallet',
    detail: 'Your wallet shows the network fee for transactions it submits, such as withdrawals.',
  },
] as const;

function CostTable({
  caption,
  valueLabel,
  rows,
}: {
  caption: string;
  valueLabel: string;
  rows: readonly (readonly [string, string])[];
}) {
  return (
    <table className="app-divider mt-4 w-full text-left text-sm">
      <caption className="mb-2 text-left font-semibold text-ink">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Item</th>
          <th scope="col">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-white/10">
            <th scope="row" className="py-2 pr-3 font-medium text-ink">
              {label}
            </th>
            <td className="py-2 text-right tabular-nums text-ink-muted">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Cost() {
  return (
    <section className="app-page">
      <PageHeading
        title="Cost & custody model"
        description="See which costs Rulebook sponsors and how your wallet keeps control of your funds."
      />

      <section className="app-panel" aria-labelledby="cost-breakdown">
        <div className="app-panel-header app-panel-pad">
          <span className="app-icon">
            <HugeiconsIcon icon={Coins01Icon} size={21} aria-hidden="true" />
          </span>
          <h2 id="cost-breakdown" className="app-panel-heading">
            Who pays for what
          </h2>
        </div>
        <dl className="app-divider app-cost-list">
          {COSTS.map(({ activity, payer, detail }) => (
            <div key={activity} className="app-panel-pad">
              <dt>{activity}</dt>
              <dd className="app-tag" data-tone={payer === 'Operator' ? 'positive' : undefined}>
                {payer}
              </dd>
              <dd className="app-copy">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="app-panel app-panel-pad" aria-labelledby="measured-costs">
        <h2 id="measured-costs" className="app-panel-heading">
          Estimated execution costs
        </h2>
        <p className="app-copy">
          Base fees measured on <time dateTime={costModel.measuredOn}>{costModel.measuredOn}</time>.
          Estimates vary with gas prices and event volume.
        </p>
        <CostTable caption="Observed base fees" valueLabel="Base fee" rows={costModel.baseFees} />
        <CostTable caption="Per call" valueLabel="Estimated cost" rows={costModel.calls} />
        <CostTable caption="Annual estimate" valueLabel="REACT per year" rows={costModel.annual} />
        <p className="app-copy mt-4">
          Weekly and daily rules on the same cron schedule wake up for the same ticks. Price rules
          cost more when their pools emit more events.
        </p>
      </section>

      <section className="app-panel app-panel-pad app-custody" aria-labelledby="cost-custody">
        <span className="app-icon">
          <HugeiconsIcon icon={SecurityCheckIcon} size={21} aria-hidden="true" />
        </span>
        <div className="space-y-2">
          <h2 id="cost-custody" className="app-panel-heading">
            Your wallet owns the vault
          </h2>
          <p className="app-copy">
            Your vault on Unichain Sepolia settles actions permitted by your rules. The operator can
            fund execution credit. Only the vault owner can withdraw principal directly.
          </p>
          <Link to={appRoutes.account} className="app-link inline-block text-sm">
            View your vault
          </Link>
        </div>
      </section>
    </section>
  );
}
