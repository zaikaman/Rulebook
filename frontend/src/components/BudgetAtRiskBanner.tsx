import type { Address, SponsorStatus } from '@rulebook/shared';

export type AtRiskState = 'healthy' | 'low' | 'exhausted' | 'debt';

const HEADLINE: Record<Exclude<AtRiskState, 'healthy'>, string> = {
  low: 'Execution credit is running low',
  exhausted: 'This account is silent — no execution credit',
  debt: 'Callbacks are blocked by outstanding reaction fees',
};

const CONSEQUENCE: Record<Exclude<AtRiskState, 'healthy'>, string> = {
  low: 'Rules stop running when credit reaches zero. Top up before the next window.',
  exhausted: 'None of your rules will run until the account is topped up. They are not active.',
  debt: 'Reaction fees are unpaid, so callbacks are refused until the debt is cleared.',
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

/**
 * A banner shown before the account goes silent, with the permissionless top-up path and the
 * target-address caveat: a plain transfer to the system contract does not credit an account.
 */
export function BudgetAtRiskBanner({
  state,
  agent,
}: {
  readonly state: AtRiskState;
  readonly agent?: Address;
}) {
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
      <p className="text-xs text-ink-muted">
        Topping up is permissionless and never gives the operator custody. Call{' '}
        <code className="font-mono">depositTo({agent ?? 'your agent'})</code> on the Lasna system
        contract with the amount you want to add. A plain transfer without the target address does
        not credit your account and can leave funds stranded.
      </p>
    </aside>
  );
}
