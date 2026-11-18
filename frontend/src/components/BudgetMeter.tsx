import type { RuleBudget } from '@rulebook/shared';

const COPY: Record<RuleBudget['state'], { label: string; detail: string }> = {
  healthy: {
    label: 'Execution credit is healthy',
    detail: 'The sponsor can pay for this rule’s next wake-ups.',
  },
  low: {
    label: 'Execution credit is low',
    detail: 'Top up soon or the rule will go silent before its next window.',
  },
  exhausted: {
    label: 'Silent — execution credit is exhausted',
    detail: 'The rule cannot run until the account is topped up. It is not active.',
  },
  debt: {
    label: 'Silent — the account owes reaction fees',
    detail: 'A debt blocks callbacks. Top up to clear it before the rule can run again.',
  },
};

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
  const copy = COPY[budget.state];
  const warning = budget.threshold;
  const width = asPercent(budget.remaining, warning * 2n);
  const markerPosition = 50;

  return (
    <div
      data-testid="budget-meter"
      data-state={budget.state}
      data-tone={
        budget.state === 'healthy' ? 'success' : budget.state === 'low' ? 'warning' : 'error'
      }
      className="app-alert space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{copy.label}</span>
        <span className="break-all font-mono text-xs">
          {budget.remaining.toString()} wei remaining
        </span>
      </div>

      <div
        role="meter"
        aria-label="Execution credit remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        className="relative h-2 overflow-hidden rounded-full bg-surface"
      >
        <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${width}%` }} />
        <span
          aria-hidden="true"
          data-testid="budget-threshold-marker"
          className="absolute top-0 h-full w-px bg-ink"
          style={{ left: `${markerPosition}%` }}
        />
      </div>

      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <span className="break-all">Warning below {budget.threshold.toString()} wei</span>
        <span>{copy.detail}</span>
      </div>
    </div>
  );
}
