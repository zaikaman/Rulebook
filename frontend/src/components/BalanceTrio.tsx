export interface BalanceTrioProps {
  /** Principal held in the user's own vault. */
  readonly principal: string;
  /** Funds-side execution cost already covered by the sponsor. */
  readonly executionCost: string;
  /** Watching-side credit remaining on Reactive Lasna. */
  readonly watchingCredit: string;
}

/**
 * Shows the three balances as three separate figures (FR-008). The component exposes no total
 * and no combining API, so sponsored credit can never be presented as principal.
 */
export function BalanceTrio({ principal, executionCost, watchingCredit }: BalanceTrioProps) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Balances">
      <div
        className="rounded-lg border border-border bg-surface-raised p-4"
        data-figure="principal"
      >
        <dt className="text-xs uppercase tracking-wide text-ink-muted">Principal (your funds)</dt>
        <dd className="mt-1 font-mono text-lg text-ink">{principal}</dd>
      </div>
      <div
        className="rounded-lg border border-border bg-surface-raised p-4"
        data-figure="execution-cost"
      >
        <dt className="text-xs uppercase tracking-wide text-ink-muted">
          Execution cost (funds side, sponsored)
        </dt>
        <dd className="mt-1 font-mono text-lg text-ink">{executionCost}</dd>
      </div>
      <div
        className="rounded-lg border border-border bg-surface-raised p-4"
        data-figure="watching-credit"
      >
        <dt className="text-xs uppercase tracking-wide text-ink-muted">
          Watching credit (automation side)
        </dt>
        <dd className="mt-1 font-mono text-lg text-ink">{watchingCredit}</dd>
      </div>
    </dl>
  );
}
