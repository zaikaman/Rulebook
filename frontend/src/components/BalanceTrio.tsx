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
    <div className="grid gap-3 lg:grid-cols-3">
      <section
        aria-label={`${getChain(UNICHAIN_SEPOLIA_CHAIN_ID).name} balances`}
        className="space-y-3 rounded-lg border border-border bg-surface-raised p-4 lg:col-span-2"
      >
        <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
        <dl className="grid gap-4 sm:grid-cols-2">
          <div data-figure="principal">
            <dt className="text-sm text-ink-muted">Principal (your funds)</dt>
            <dd className="mt-1 break-words font-mono text-lg text-ink">{principal}</dd>
          </div>
          <div data-figure="execution-cost">
            <dt className="text-sm text-ink-muted">Execution cost (sponsored)</dt>
            <dd className="mt-1 break-words font-mono text-lg text-ink">{executionCost}</dd>
          </div>
        </dl>
      </section>
      <section
        aria-label={`${getChain(LASNA_CHAIN_ID).name} balances`}
        className="space-y-3 rounded-lg border border-border bg-surface-raised p-4"
      >
        <NetworkBadge chainId={LASNA_CHAIN_ID} />
        <dl>
          <div data-figure="watching-credit">
            <dt className="text-sm text-ink-muted">Watching credit (sponsored)</dt>
            <dd className="mt-1 break-words font-mono text-lg text-ink">{watchingCredit}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
import { getChain, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';

import { NetworkBadge } from './NetworkBadge.js';
