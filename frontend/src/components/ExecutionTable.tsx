import type { Execution } from '@rulebook/shared';
import { Link } from 'react-router';

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
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-ink-muted">
        No execution yet. A rule only appears here after it fires and the funds side reports an
        outcome.
      </p>
    );
  }

  return (
    <table className="w-full text-left text-xs">
      <thead className="text-ink-muted">
        <tr>
          <th className="py-2">Time</th>
          <th className="py-2">Chain</th>
          <th className="py-2">Status</th>
          <th className="py-2">Transaction</th>
          <th className="py-2">Proof</th>
        </tr>
      </thead>
      <tbody>
        {executions.map((execution) => (
          <tr key={`${execution.chain_id}-${execution.tx_hash}`} className="border-t border-border">
            <td className="py-2 text-ink">
              {execution.block_time.slice(0, 16).replace('T', ' ')}
            </td>
            <td className="py-2 text-ink-muted">{execution.chain_id}</td>
            <td className="py-2 text-ink">{execution.status}</td>
            <td className="py-2">
              <TxLink chainId={execution.chain_id} txHash={execution.tx_hash} />
            </td>
            <td className="py-2">
              {execution.reactive_tx_hash ? (
                <Link
                  to={`/proof/${execution.reactive_tx_hash}`}
                  className="text-ink underline decoration-dotted"
                >
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
  );
}
