import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID, type SponsorStatus } from '@rulebook/shared';
import { Link } from 'react-router';

import { ruleFeeFundingRoute, ruleFees, type RuleFee } from '../lib/funding.js';

const feeByChain: Readonly<Partial<Record<number, RuleFee>>> = {
  [LASNA_CHAIN_ID]: 'watching',
  [UNICHAIN_SEPOLIA_CHAIN_ID]: 'execution',
};

export function BudgetAtRiskBanner({
  sponsor,
  beforeFirstRule = false,
  canFund = true,
}: {
  sponsor?: SponsorStatus;
  beforeFirstRule?: boolean;
  canFund?: boolean;
}) {
  if (!sponsor) return null;
  const affected = sponsor.chains.flatMap(({ chain_id, state }) => {
    const fee = feeByChain[chain_id];
    return fee && state !== 'healthy' ? [{ fee, state }] : [];
  });
  if (affected.length === 0) return null;

  const blocked = affected.some(({ state }) => state === 'exhausted' || state === 'debt');
  const headline = beforeFirstRule
    ? 'Fund your rules before they run'
    : blocked
      ? 'Network fees need attention'
      : 'Low balance for network fees';

  return (
    <aside
      aria-label="Rule fee status"
      data-tone={!beforeFirstRule && blocked ? 'error' : 'warning'}
      className="app-alert space-y-2"
    >
      <p role="status" className="text-sm font-semibold text-ink">
        {headline}
      </p>
      <ul className="space-y-2">
        {affected.map(({ fee, state }) => {
          const { title, token } = ruleFees[fee];
          const action = fee === 'watching' ? 'monitor rules' : 'run trades and transfers';
          return (
            <li
              key={fee}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink"
            >
              <span>
                {state === 'debt'
                  ? `${title} are due`
                  : `The ${title.toLowerCase()} balance is ${state === 'low' ? 'low' : 'empty'}`}{' '}
                on {token.network.name}.
              </span>
              {canFund && (
                <Link
                  to={ruleFeeFundingRoute(fee)}
                  state={{ fundingAgent: sponsor.agent }}
                  className="app-link"
                >
                  Add test {token.symbol} to {action}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
