import type { RuleBudget } from '@rulebook/shared';

const STATE: Record<RuleBudget['state'], { label: string; detail: string }> = {
  healthy: {
    label: 'Healthy',
    detail: 'Enough credit for the rule’s upcoming checks.',
  },
  low: {
    label: 'Low',
    detail: 'Top up soon or the rule goes silent before its next window.',
  },
  exhausted: {
    label: 'Exhausted',
    detail: 'The rule cannot run until the account is topped up. It is not active.',
  },
  debt: {
    label: 'Fees owed',
    detail: 'A debt blocks callbacks. Top up to clear it before the rule can run again.',
  },
};

const TONE: Record<RuleBudget['state'], 'success' | 'warning' | 'error'> = {
  healthy: 'success',
  low: 'warning',
  exhausted: 'error',
  debt: 'error',
};

/**
 * Wei as an ETH figure with at most four decimals. Values too small to show keep an explicit
 * lower bound so an almost-empty credit never reads as zero.
 */
export function ethAmount(wei: bigint): string {
  if (wei === 0n) return '0';
  const step = 10n ** 14n;
  const rounded = (wei + step / 2n) / step;
  if (rounded === 0n) return '<0.0001';
  const whole = rounded / 10_000n;
  const fraction = (rounded % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function asPercent(value: bigint, scale: bigint): number {
  if (scale === 0n) return 0;
  const clamped = value > scale ? scale : value;
  return Number((clamped * 100n) / scale);
}

/**
 * Remaining execution credit against its warning threshold. The bar is scaled to twice the
 * threshold, so the marker sits halfway: above it the account is healthy, below it the warning
 * is real. `low`, `exhausted`, and `debt` never reuse the `active` colour, and each names the
 * consequence instead of showing a reassuring "active" pill.
 */
export function BudgetMeter({ budget }: { readonly budget: RuleBudget }) {
  const state = STATE[budget.state];
  const remaining = ethAmount(budget.remaining);
  const threshold = ethAmount(budget.threshold);
  const width = asPercent(budget.remaining, budget.threshold * 2n);

  return (
    <div
      data-testid="budget-meter"
      data-state={budget.state}
      data-tone={TONE[budget.state]}
      className="app-credit"
    >
      <div className="app-credit-head">
        <h3 className="app-credit-label">Execution credit</h3>
        <span className="app-credit-value" title={`${budget.remaining.toString()} wei`}>
          {remaining} <span>ETH</span>
        </span>
      </div>

      <div
        role="meter"
        aria-label="Execution credit remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-valuetext={`${remaining} ETH remaining, ${state.label.toLowerCase()}. Warning below ${threshold} ETH.`}
        className="app-credit-track"
      >
        <span className="app-credit-fill" style={{ width: `${width}%` }} />
        <span
          aria-hidden="true"
          data-testid="budget-threshold-marker"
          className="app-credit-tick"
        />
      </div>

      <div className="app-credit-foot">
        <span className="app-credit-state">{state.label}</span>
        <span>Warning below {threshold} ETH</span>
      </div>
      <p className="app-credit-detail">{state.detail}</p>
    </div>
  );
}
