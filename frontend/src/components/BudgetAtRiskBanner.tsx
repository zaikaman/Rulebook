import type { SponsorStatus } from '@rulebook/shared';

export type AtRiskState = 'healthy' | 'low' | 'exhausted' | 'debt';

const HEADLINE: Record<Exclude<AtRiskState, 'healthy'>, string> = {
  low: 'Low balance for network fees',
  exhausted: 'Your rules can’t run right now',
  debt: 'Unpaid network fees',
};

const CONSEQUENCE: Record<Exclude<AtRiskState, 'healthy'>, string> = {
  low: 'Your rules can keep running until this balance runs out.',
  exhausted: 'The balance that Rulebook uses to pay network fees for your rules has run out.',
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

/** Explains how the fee balance affects rules and links to the manual top-up guide. */
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
      <a
        href="https://github.com/zaikaman/Rulebook/blob/main/docs/runbooks/top-up-reserves.md"
        target="_blank"
        rel="noreferrer"
        className="app-link inline-block text-xs"
      >
        Manual top-up guide
      </a>
    </aside>
  );
}
