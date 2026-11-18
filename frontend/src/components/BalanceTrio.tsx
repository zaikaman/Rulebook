import { FlashIcon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';

import { AddressLink } from './AddressLink.js';
import { NetworkBadge } from './NetworkBadge.js';

export interface BalanceTrioProps {
  /** Principal held in the user's own vault. */
  readonly principal: string;
  /** Funds-side execution cost already covered by the sponsor. */
  readonly executionCost: string;
  /** Watching-side credit remaining on Reactive Lasna. */
  readonly watchingCredit: string;
  readonly accounts?: { readonly agent: Address; readonly vault: Address };
}

/**
 * Shows the three balances as three separate figures (FR-008). The component exposes no total
 * and no combining API, so sponsored credit can never be presented as principal.
 */
export function BalanceTrio({
  principal,
  executionCost,
  watchingCredit,
  accounts,
}: BalanceTrioProps) {
  return (
    <div className="app-panel app-balance-grid">
      <section
        aria-label={`${getChain(UNICHAIN_SEPOLIA_CHAIN_ID).name} balances`}
        className="app-panel-pad space-y-4"
      >
        <div className="app-panel-header">
          <span className="app-icon">
            <HugeiconsIcon icon={Wallet01Icon} size={19} aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h2 className="app-panel-heading">Funds account</h2>
            <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
          </div>
        </div>
        <dl className="app-divider grid gap-x-4 gap-y-3 pt-4 sm:grid-cols-2">
          <div data-figure="principal">
            <dt className="text-sm text-ink-muted">Principal (your funds)</dt>
            <dd className="app-balance-value">{principal}</dd>
          </div>
          <div data-figure="execution-cost">
            <dt className="text-sm text-ink-muted">Execution cost (sponsored)</dt>
            <dd className="app-balance-value">{executionCost}</dd>
          </div>
        </dl>
        {accounts ? (
          <div className="app-divider flex flex-wrap items-center justify-between gap-2 pt-3">
            <span className="text-xs text-ink-muted">Vault contract</span>
            <AddressLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} address={accounts.vault} />
          </div>
        ) : null}
      </section>
      <section
        aria-label={`${getChain(LASNA_CHAIN_ID).name} balances`}
        className="app-panel-pad space-y-4"
      >
        <div className="app-panel-header">
          <span className="app-icon">
            <HugeiconsIcon icon={FlashIcon} size={19} aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h2 className="app-panel-heading">Automation account</h2>
            <NetworkBadge chainId={LASNA_CHAIN_ID} />
          </div>
        </div>
        <dl className="app-divider pt-4">
          <div data-figure="watching-credit">
            <dt className="text-sm text-ink-muted">Watching credit (sponsored)</dt>
            <dd className="app-balance-value">{watchingCredit}</dd>
          </div>
        </dl>
        {accounts ? (
          <div className="app-divider flex flex-wrap items-center justify-between gap-2 pt-3">
            <span className="text-xs text-ink-muted">Agent contract</span>
            <AddressLink chainId={LASNA_CHAIN_ID} address={accounts.agent} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
