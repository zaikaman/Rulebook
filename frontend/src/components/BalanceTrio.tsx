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

function BalanceFigure({ value }: { readonly value: string }) {
  const separator = value.lastIndexOf(' ');
  if (separator === -1) return <>{value}</>;
  return (
    <>
      {value.slice(0, separator)}
      <span className="app-balance-unit">{value.slice(separator)}</span>
    </>
  );
}

export interface BalanceTrioProps {
  /** Principal held in the user's own vault. */
  readonly principal: string;
  /** Fee balance on the network that carries out the rule. */
  readonly executionCost: string;
  /** Watching-side credit remaining on Reactive Lasna. */
  readonly watchingCredit: string;
  readonly accounts?: { readonly agent: Address; readonly vault: Address };
}

/**
 * Shows the three balances as three separate figures (FR-008). The component exposes no total
 * and no combining API so fee credit stays separate from principal.
 */
export function BalanceTrio({
  principal,
  executionCost,
  watchingCredit,
  accounts,
}: BalanceTrioProps) {
  return (
    <section className="app-panel app-balance-trio" aria-labelledby="account-balances">
      <div className="app-balance-trio-head app-panel-pad">
        <h2 id="account-balances" className="app-panel-heading">
          Balances
        </h2>
        <p className="app-copy">
          Principal and both fee credits are reported separately, so a fee balance never hides your
          funds.
        </p>
      </div>
      <div className="app-balance-lanes">
        <section
          aria-label={`${getChain(UNICHAIN_SEPOLIA_CHAIN_ID).name} balances`}
          data-chain-role="funds"
          className="app-balance-lane"
        >
          <header className="app-balance-lane-head">
            <span className="app-icon app-balance-lane-icon">
              <HugeiconsIcon icon={Wallet01Icon} size={19} aria-hidden="true" />
            </span>
            <div className="app-balance-lane-identity">
              <h3 className="app-balance-lane-title">Funds account</h3>
              <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
            </div>
          </header>
          <dl className="app-balance-figures">
            <div data-figure="principal">
              <dt>Principal (your funds)</dt>
              <dd className="app-balance-value">
                <BalanceFigure value={principal} />
              </dd>
            </div>
            <div data-figure="execution-cost">
              <dt>Execution fees</dt>
              <dd className="app-balance-value">
                <BalanceFigure value={executionCost} />
              </dd>
            </div>
          </dl>
          {accounts ? (
            <div className="app-balance-contract">
              <span>Vault contract</span>
              <AddressLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} address={accounts.vault} />
            </div>
          ) : null}
        </section>

        <section
          aria-label={`${getChain(LASNA_CHAIN_ID).name} balances`}
          data-chain-role="automation"
          className="app-balance-lane"
        >
          <header className="app-balance-lane-head">
            <span className="app-icon app-balance-lane-icon">
              <HugeiconsIcon icon={FlashIcon} size={19} aria-hidden="true" />
            </span>
            <div className="app-balance-lane-identity">
              <h3 className="app-balance-lane-title">Automation account</h3>
              <NetworkBadge chainId={LASNA_CHAIN_ID} />
            </div>
          </header>
          <dl className="app-balance-figures">
            <div data-figure="watching-credit">
              <dt>Monitoring fees</dt>
              <dd className="app-balance-value">
                <BalanceFigure value={watchingCredit} />
              </dd>
            </div>
          </dl>
          {accounts ? (
            <div className="app-balance-contract">
              <span>Agent contract</span>
              <AddressLink chainId={LASNA_CHAIN_ID} address={accounts.agent} />
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
