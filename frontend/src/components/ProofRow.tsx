import type { ProofRow as ProofRowData } from '@rulebook/shared';

import { NetworkBadge } from './NetworkBadge.js';

const ROLE_LABEL: Record<ProofRowData['role'], string> = {
  origin: 'Origin event',
  automation: 'Automation',
  destination: 'Destination',
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
      className="space-y-2 rounded-lg border border-border bg-surface-raised p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-ink">{ROLE_LABEL[row.role]}</span>
        <NetworkBadge chainId={row.chain_id} />
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
        className="block break-all font-mono text-xs text-ink underline decoration-dotted underline-offset-4"
        title={row.tx_hash}
      >
        {row.tx_hash}
      </a>

      {row.error ? (
        <div className="rounded border border-cancelled/40 bg-cancelled/10 p-3 text-xs">
          <p className="text-ink">{row.error.human}</p>
          <code
            data-testid="proof-error-selector"
            className="mt-1 block break-all font-mono text-ink-muted"
          >
            {row.error.selector}
          </code>
        </div>
      ) : null}
    </li>
  );
}
