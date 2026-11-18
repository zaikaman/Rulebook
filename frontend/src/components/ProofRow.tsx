import { Activity01Icon, FlashIcon, TransactionHistoryIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ProofRow as ProofRowData } from '@rulebook/shared';

import { NetworkBadge } from './NetworkBadge.js';

const ROLE_LABEL: Record<ProofRowData['role'], string> = {
  origin: 'Origin event',
  automation: 'Automation',
  destination: 'Destination',
};
const ROLE_ICON = {
  origin: Activity01Icon,
  automation: FlashIcon,
  destination: TransactionHistoryIcon,
};

function clock(timestamp: string | undefined): string {
  if (!timestamp) return '—';
  return `${new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

export interface ProofRowProps {
  readonly row: ProofRowData;
}

/**
 * One leg of the loop: its role, network, block, timestamp, explorer link, and — when the
 * destination refused — the raw selector next to a plain-language reason (FR-031, FR-051).
 */
export function ProofRow({ row }: ProofRowProps) {
  return (
    <li
      data-testid="proof-row"
      data-role={row.role}
      data-execution-role={row.execution_role}
      className="app-proof-leg"
    >
      <div className="app-proof-leg-marker">
        <span className="app-icon">
          <HugeiconsIcon icon={ROLE_ICON[row.role]} size={18} aria-hidden="true" />
        </span>
      </div>
      <div className="app-proof-leg-content">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="app-panel-heading">{ROLE_LABEL[row.role]}</h2>
          {row.execution_role ? (
            <span
              className="app-tag"
              data-tone={row.execution_role === 'leader' ? 'neutral' : 'positive'}
            >
              {row.execution_role === 'leader' ? 'Leader trade' : 'Follower trade'}
            </span>
          ) : null}
          <NetworkBadge chainId={row.chain_id} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-ink-muted">
            {row.block_number !== undefined ? `Block ${row.block_number}` : 'Block pending'}
          </span>
          <time className="font-mono text-xs text-ink-muted" dateTime={row.timestamp}>
            {clock(row.timestamp)}
          </time>
        </div>

        <a
          href={row.explorer_url}
          target="_blank"
          rel="noreferrer"
          className="app-link mt-2 block break-all font-mono text-xs"
          title={row.tx_hash}
        >
          {row.tx_hash}
        </a>

        {row.error ? (
          <div className="app-alert mt-3 text-xs" data-tone="error">
            <p className="text-ink">{row.error.human}</p>
            <code
              data-testid="proof-error-selector"
              className="mt-1 block break-all font-mono text-ink-muted"
            >
              {row.error.selector}
            </code>
          </div>
        ) : null}
      </div>
    </li>
  );
}
