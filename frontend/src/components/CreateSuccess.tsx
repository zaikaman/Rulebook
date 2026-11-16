import { LASNA_CHAIN_ID } from '@rulebook/shared';
import { Link } from 'react-router';

import { TxLink } from './TxLink.js';
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
    <section
      aria-labelledby="create-success-heading"
      className="space-y-3 rounded-lg border border-active/40 bg-active/5 p-5"
    >
      <h2 id="create-success-heading" className="text-lg font-semibold text-ink">
        Rule created{ruleId !== null ? ` — #${ruleId.toString()}` : ''}
      </h2>
      <p className="text-sm text-ink">“{sentence}”</p>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        <span>Signed once on</span>
        <TxLink chainId={LASNA_CHAIN_ID} txHash={txHash} />
      </div>
      <div className="flex flex-wrap gap-2">
        {ruleId !== null ? (
          <Link
            to={`/rules/${agent}/${ruleId.toString()}`}
            className="rounded-full border border-border px-3 py-1 text-xs text-ink"
          >
            View rule
          </Link>
        ) : null}
        <Link to="/rules" className="rounded-full border border-border px-3 py-1 text-xs text-ink">
          All rules
        </Link>
        <button
          type="button"
          onClick={onCreateAnother}
          className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-surface"
        >
          Build another
        </button>
      </div>
    </section>
  );
}
