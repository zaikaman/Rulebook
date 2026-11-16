import {
  callbackRecordSchema,
  systemContractAbi,
  type CallbackRecord,
  type TxHash,
} from '@rulebook/shared';
import { toHex, type Address, type PublicClient } from 'viem';

/** Reads the authoritative callback records for one reactive transaction. */
export interface CallbackReader {
  readCallbacks(reactiveTxHash: TxHash): Promise<CallbackRecord[]>;
}

/**
 * `getCallbacks` is the judge-facing proof source: the automation → destination half of a
 * proof never depends on our indexer (SC-005). The tuple ABI lives in `@rulebook/shared` so the
 * browser fallback and this reader cannot drift apart.
 */
export function createLasnaCallbackReader(
  client: PublicClient,
  systemContract: Address,
): CallbackReader {
  return {
    async readCallbacks(reactiveTxHash: TxHash): Promise<CallbackRecord[]> {
      const records = await client.readContract({
        address: systemContract,
        abi: systemContractAbi,
        functionName: 'getCallbacks',
        args: [BigInt(reactiveTxHash)],
      });

      return records.map((record) =>
        callbackRecordSchema.parse({
          block_number: Number(record.blockNumber),
          reacting_contract: record.reactingContract,
          callback_index: Number(record.callbackIndex),
          destination_chain_id: Number(record.destinationChainId),
          destination_tx_hash: toHex(record.destinationTxHash, { size: 32 }),
          error_data: record.errorData,
        }),
      );
    },
  };
}
