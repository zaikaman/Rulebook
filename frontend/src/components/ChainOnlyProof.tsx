import { getChain, LASNA_CHAIN_ID, systemContractAbi, type CallbackRecord } from '@rulebook/shared';
import { useState } from 'react';
import { createPublicClient, http, toHex } from 'viem';

const ZERO_TX_HASH = `0x${'0'.repeat(64)}`;

function toRecord(record: {
  blockNumber: bigint;
  reactingContract: `0x${string}`;
  callbackIndex: bigint;
  destinationChainId: bigint;
  destinationTxHash: bigint;
  errorData: `0x${string}`;
}): CallbackRecord {
  return {
    block_number: Number(record.blockNumber),
    reacting_contract: record.reactingContract.toLowerCase() as `0x${string}`,
    callback_index: Number(record.callbackIndex),
    destination_chain_id: Number(record.destinationChainId),
    destination_tx_hash: toHex(record.destinationTxHash, { size: 32 }),
    error_data: record.errorData,
  };
}

export interface ChainOnlyProofProps {
  readonly reactiveTxHash: string;
}

/**
 * Judge-facing fallback: when the backend is unreachable, read `getCallbacks` directly from
 * Lasna in the browser. Hidden behind `VITE_ENABLE_CHAIN_ONLY_PROOF`; it deliberately shows
 * only what the chain can prove (the automation and destination legs, not the origin log
 * decoded by our indexer).
 */
export function ChainOnlyProof({ reactiveTxHash }: ChainOnlyProofProps) {
  const [records, setRecords] = useState<CallbackRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const lasna = getChain(LASNA_CHAIN_ID);

  async function readFromChain(): Promise<void> {
    setReading(true);
    setError(null);
    try {
      const client = createPublicClient({ transport: http(lasna.rpcUrl) });
      const data = await client.readContract({
        address: lasna.systemContract,
        abi: systemContractAbi,
        functionName: 'getCallbacks',
        args: [BigInt(reactiveTxHash)],
      });
      setRecords(data.map(toRecord));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Lasna read failed.');
    } finally {
      setReading(false);
    }
  }

  return (
    <section className="app-panel app-panel-pad space-y-3">
      <div className="space-y-1">
        <h2 className="app-panel-heading">Read the proof directly from Lasna</h2>
        <p className="app-copy">
          This path bypasses Rulebook entirely. It proves the automation and destination legs from{' '}
          <code className="font-mono">getCallbacks</code>; the origin leg still needs the
          Agent&apos;s <code className="font-mono">RuleEvaluated</code> log.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void readFromChain()}
        disabled={reading}
        className="app-button"
      >
        {reading ? 'Reading Lasna…' : 'Read getCallbacks'}
      </button>

      {error ? (
        <p className="app-alert text-xs" data-tone="error" role="alert">
          {error}
        </p>
      ) : null}

      {records ? (
        <ul className="app-divider app-rules-list text-xs">
          {records.map((record) => (
            <li key={record.callback_index} className="space-y-1 py-3">
              <p className="font-mono text-ink">
                callback {record.callback_index} · block {record.block_number}
              </p>
              <p className="break-all font-mono text-ink-muted">
                {record.destination_tx_hash === ZERO_TX_HASH
                  ? 'destination transaction not recorded'
                  : record.destination_tx_hash}
              </p>
              {record.error_data && record.error_data !== '0x' ? (
                <p className="mt-1 break-all font-mono text-cancelled">
                  {record.error_data.slice(0, 10)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
