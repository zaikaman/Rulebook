import type { Execution } from '@rulebook/shared';
import { Link } from 'react-router';

import { NetworkBadge } from './NetworkBadge.js';
import { TxLink } from './TxLink.js';

export interface ExecutionTableProps {
  readonly executions: readonly Execution[];
  /**
   * When every row shares one network, the caller labels it once in the section heading and
   * drops the column, so a short history does not repeat the same badge on every row.
   */
  readonly showNetwork?: boolean;
}

const TONE: Record<Execution['status'], 'positive' | 'warning' | 'error'> = {
  confirmed: 'positive',
  pending: 'warning',
  refused: 'error',
};

/**
 * Execution history as a ledger: one row per run, with the destination transaction and its
 * proof link. The proof link is keyed by the reactive transaction, because that is the hash
 * `getCallbacks` understands (T145).
 */
export function ExecutionTable({ executions, showNetwork = true }: ExecutionTableProps) {
  if (executions.length === 0) {
    return (
      <p className="app-panel-pad text-sm text-ink-muted">
        No execution yet. Results appear here after the rule fires and the destination chain reports
        an outcome.
      </p>
    );
  }

  return (
    <div className="app-executions" data-network={showNetwork}>
      <div className="app-execution-labels" aria-hidden="true">
        <span>Time (UTC)</span>
        {showNetwork ? <span>Network</span> : null}
        <span>Status</span>
        <span>Transaction</span>
        <span>Proof</span>
      </div>
      <ol className="app-execution-list" aria-label="Execution history">
        {executions.map((execution) => (
          <li
            key={`${execution.chain_id}-${execution.tx_hash}`}
            className="app-execution"
            data-network={showNetwork}
          >
            <time className="app-execution-time" dateTime={execution.block_time}>
              {execution.block_time.slice(0, 16).replace('T', ' ')}
            </time>
            {showNetwork ? (
              <span className="app-execution-network">
                <NetworkBadge chainId={execution.chain_id} />
              </span>
            ) : null}
            <span className="app-execution-status">
              <span className="app-tag" data-tone={TONE[execution.status]}>
                {execution.status}
              </span>
            </span>
            <span className="app-execution-tx">
              <TxLink chainId={execution.chain_id} txHash={execution.tx_hash} />
            </span>
            <span className="app-execution-proof">
              {execution.reactive_tx_hash ? (
                <Link to={`/proof/${execution.reactive_tx_hash}`} className="app-link text-xs">
                  View proof
                </Link>
              ) : (
                <span className="text-xs text-ink-muted">No proof</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
