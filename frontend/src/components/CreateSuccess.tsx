import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { LASNA_CHAIN_ID } from '@rulebook/shared';
import { Link } from 'react-router';

import { TxLink } from './TxLink.js';
import { NetworkBadge } from './NetworkBadge.js';
import type { Address } from '@rulebook/shared';

export interface CreateSuccessProps {
  readonly agent: Address;
  readonly ruleId: bigint | null;
  readonly sentence: string;
  readonly txHash: `0x${string}`;
  readonly onCreateAnother: () => void;
}

/** The confirmation state: the rule id, its sentence, the Lasna receipt, and next actions. */
export function CreateSuccess({
  agent,
  ruleId,
  sentence,
  txHash,
  onCreateAnother,
}: CreateSuccessProps) {
  return (
    <section aria-labelledby="create-success-heading" className="app-panel app-panel-pad space-y-4">
      <div className="app-panel-header">
        <span className="app-icon">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={21}
            className="text-active"
            aria-hidden="true"
          />
        </span>
        <h2 id="create-success-heading" className="app-panel-heading">
          Rule created{ruleId !== null ? ` · #${ruleId.toString()}` : ''}
        </h2>
      </div>
      <p className="break-words font-heading text-xl font-semibold text-ink">“{sentence}”</p>
      <div className="app-divider flex flex-wrap items-center gap-3 pt-3 text-xs text-ink-muted">
        <NetworkBadge chainId={LASNA_CHAIN_ID} />
        <TxLink chainId={LASNA_CHAIN_ID} txHash={txHash} label="View receipt" />
      </div>
      <div className="flex flex-wrap gap-2">
        {ruleId !== null ? (
          <Link
            to={`/rules/${agent}/${ruleId.toString()}`}
            className="app-button app-button--primary"
          >
            View rule
          </Link>
        ) : null}
        <Link to="/rules" className="app-button">
          All rules
        </Link>
        <button type="button" onClick={onCreateAnother} className="app-button">
          Build another
        </button>
      </div>
    </section>
  );
}
