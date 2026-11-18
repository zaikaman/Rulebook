import type { Execution } from '@rulebook/shared';
import { Link } from 'react-router';

import { NetworkBadge } from './NetworkBadge.js';
import { TxLink } from './TxLink.js';

export interface ExecutionTableProps {
  readonly executions: readonly Execution[];
}

/**
 * Execution history with a proof link per row. The link is keyed by the reactive transaction,
 * because that is the hash `getCallbacks` understands (T145).
 */
export function ExecutionTable({ executions }: ExecutionTableProps) {
  if (executions.length === 0) {
    return (
      <p className="app-divider app-panel-pad text-sm text-ink-muted">
        No execution yet. Results appear here after the rule fires and the destination chain reports
        an outcome.
      </p>
    );
  }

  return (
    <div
      className="app-table-wrap app-divider rounded-t-none"
      role="region"
      aria-label="Execution transactions"
      tabIndex={0}
    >
      <table className="app-table min-w-[31rem]">
        <thead>
          <tr>
            <th scope="col">Time (UTC)</th>
            <th scope="col">Network</th>
            <th scope="col">Status</th>
            <th scope="col">Transaction</th>
            <th scope="col">Proof</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => (
            <tr key={`${execution.chain_id}-${execution.tx_hash}`}>
              <td className="font-mono text-xs">
                <time dateTime={execution.block_time}>
                  {execution.block_time.slice(0, 16).replace('T', ' ')}
                </time>
              </td>
              <td className="whitespace-nowrap">
                <NetworkBadge chainId={execution.chain_id} />
              </td>
              <td className="capitalize">{execution.status}</td>
              <td className="whitespace-nowrap">
                <TxLink chainId={execution.chain_id} txHash={execution.tx_hash} />
              </td>
              <td className="whitespace-nowrap">
                {execution.reactive_tx_hash ? (
                  <Link to={`/proof/${execution.reactive_tx_hash}`} className="app-link">
                    View proof
                  </Link>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
