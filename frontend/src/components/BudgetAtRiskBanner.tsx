import type { SponsorStatus } from '@rulebook/shared';
import { Link } from 'react-router';
import { appRoutes } from '../lib/routes.js';

export type AtRiskState = 'healthy' | 'low' | 'exhausted' | 'debt';

const HEADLINE: Record<Exclude<AtRiskState, 'healthy'>, string> = {
  low: 'Low balance for network fees',
  exhausted: 'Your rules can’t run right now',
  debt: 'Unpaid network fees',
};

const CONSEQUENCE: Record<Exclude<AtRiskState, 'healthy'>, string> = {
  low: 'Your rules can keep running until this balance runs out.',
  exhausted: 'Add network fees to keep your rules running.',
  debt: 'Your rules can run again once the outstanding fees are paid.',
};

/** Reduces the per-chain sponsor readings to the single worst state a banner should show. */
export function worstSponsorState(status: SponsorStatus | undefined): AtRiskState {
  if (!status) return 'healthy';
  const order: AtRiskState[] = ['healthy', 'low', 'exhausted', 'debt'];
  return status.chains.reduce<AtRiskState>(
    (worst, chain) => (order.indexOf(chain.state) > order.indexOf(worst) ? chain.state : worst),
    'healthy',
  );
}

/** Explains how the fee balance affects rules and links to account funding. */
export function BudgetAtRiskBanner({ state }: { readonly state: AtRiskState }) {
  if (state === 'healthy') return null;

  return (
    <aside
      role="status"
      data-state={state}
      data-tone={state === 'low' ? 'warning' : 'error'}
      className="app-alert space-y-2"
    >
      <p className="text-sm font-semibold text-ink">{HEADLINE[state]}</p>
      <p className="text-xs text-ink">{CONSEQUENCE[state]}</p>
      <Link to={`${appRoutes.account}#fund-account`} className="app-link inline-block text-xs">
        Add network fees
      </Link>
    </aside>
  );
}
