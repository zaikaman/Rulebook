import {
  agentAbi,
  vaultAbi,
  getChain,
  LASNA_CHAIN_ID,
  type CallbackRecord,
  type TxHash,
} from '@rulebook/shared';
import { parseEventLogs, type PublicClient } from 'viem';

import { clientFor, type ChainClients } from './clients.js';
import { createLasnaCallbackReader } from './lasnaCallbacks.js';

/** The origin row: the log that woke the reactive contract. */
export interface ProofOrigin {
  readonly chain_id: number;
  readonly tx_hash: TxHash;
  readonly log_index: number;
  readonly block_number?: number;
  readonly timestamp?: string;
}

/** The automation row: the Lasna transaction that evaluated the rules. */
export interface ProofAutomation {
  readonly chain_id: number;
  readonly tx_hash: TxHash;
  readonly block_number?: number;
  readonly timestamp?: string;
}

/** One destination callback plus the block facts needed for a row and the latency figure. */
export interface ProofDestination {
  readonly chain_id: number;
  readonly tx_hash: TxHash;
  readonly block_number?: number;
  readonly timestamp?: string;
  readonly callback: CallbackRecord;
}

/** Everything one chain-first proof read produces, before HTTP presentation. */
export interface ChainProof {
  readonly reactive_tx: TxHash;
  readonly origin: ProofOrigin | null;
  readonly automation: ProofAutomation;
  readonly destinations: readonly ProofDestination[];
  readonly latency_ms: number | null;
  readonly callbacks: readonly CallbackRecord[];
  readonly mirrorRequests?: readonly { leaderTx: TxHash; agent: string }[];
  readonly leaderTransactions?: readonly TxHash[];
}

/**
 * The proof boundary. `read` returns `null` when Lasna has no callback record for the hash;
 * any chain/RPC failure rejects so the route can fall back to the cache (T132).
 */
export interface ProofSource {
  read(reactiveTxHash: TxHash): Promise<ChainProof | null>;
}

const ZERO_TX_HASH: TxHash = `0x${'0'.repeat(64)}`;

function timestampOf(block: { timestamp: bigint }): string {
  return new Date(Number(block.timestamp) * 1000).toISOString();
}

async function blockTimestamp(
  client: PublicClient,
  blockNumber: bigint,
): Promise<{ block_number: number; timestamp: string }> {
  const block = await client.getBlock({ blockNumber });
  return { block_number: Number(block.number), timestamp: timestampOf(block) };
}

/** Reads a receipt and its block; returns undefined when the destination tx is not mined yet. */
async function receiptFacts(
  client: PublicClient,
  txHash: TxHash,
): Promise<{ block_number: number; timestamp: string } | undefined> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    return await blockTimestamp(client, receipt.blockNumber);
  } catch {
    return undefined;
  }
}

/**
 * Builds the three-row proof from chain state only: the Lasna receipt supplies the origin log
 * via `RuleEvaluated`, `getCallbacks` supplies the destination transactions, and the destination
 * RPC supplies their timestamps (T136).
 */
export function createProofSource(clients: ChainClients): ProofSource {
  const lasna = clients.lasna;
  const callbackReader = createLasnaCallbackReader(
    lasna,
    getChain(LASNA_CHAIN_ID).systemContract as `0x${string}`,
  );

  return {
    async read(reactiveTxHash: TxHash): Promise<ChainProof | null> {
      const callbacks = await callbackReader.readCallbacks(reactiveTxHash);
      if (callbacks.length === 0) return null;

      const receipt = await lasna.getTransactionReceipt({ hash: reactiveTxHash });
      const automationFacts = await blockTimestamp(lasna, receipt.blockNumber);
      const mirrorRequests = parseEventLogs({
        abi: agentAbi,
        logs: receipt.logs,
        eventName: 'MirrorCallbackRequested',
      }).map((log) => ({ leaderTx: log.args.leaderTx, agent: log.address.toLowerCase() }));

      let origin: ProofOrigin | null = null;
      try {
        const evaluations = parseEventLogs({
          abi: agentAbi,
          logs: receipt.logs,
          eventName: 'RuleEvaluated',
        });
        const mirror = mirrorRequests[0];
        const evaluated = mirror
          ? evaluations.find(
              (log) =>
                log.args.originTxHash === mirror.leaderTx &&
                log.address.toLowerCase() === mirror.agent,
            )
          : (evaluations.find((log) => log.args.fired) ?? evaluations[0]);
        if (evaluated) {
          const originChainId = Number(evaluated.args.originChainId);
          const originTxHash = evaluated.args.originTxHash;
          const originClient = clientFor(clients, originChainId);
          const originFacts = await receiptFacts(originClient, originTxHash);
          origin = {
            chain_id: originChainId,
            tx_hash: originTxHash,
            log_index: Number(evaluated.args.originLogIndex),
            ...(originFacts ?? {}),
          };
        }
      } catch {
        // An unreadable origin log must not turn a real destination proof into a 404.
        origin = null;
      }

      const destinations: ProofDestination[] = [];
      const leaderTransactions: TxHash[] = [];
      for (const callback of callbacks) {
        if (callback.destination_tx_hash === ZERO_TX_HASH) {
          destinations.push({
            chain_id: callback.destination_chain_id,
            tx_hash: callback.destination_tx_hash,
            callback,
          });
          continue;
        }
        const destinationClient = clientFor(clients, callback.destination_chain_id);
        let facts: Awaited<ReturnType<typeof receiptFacts>>;
        try {
          const receipt = await destinationClient.getTransactionReceipt({
            hash: callback.destination_tx_hash,
          });
          if (parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: 'Executed' }).length) {
            leaderTransactions.push(callback.destination_tx_hash);
          }
          facts = await blockTimestamp(destinationClient, receipt.blockNumber);
        } catch {
          facts = undefined;
        }
        destinations.push({
          chain_id: callback.destination_chain_id,
          tx_hash: callback.destination_tx_hash,
          ...(facts ?? {}),
          callback,
        });
      }

      const destinationTimestamps = destinations
        .map((destination) => destination.timestamp)
        .filter((value): value is string => Boolean(value));
      const latestDestination = destinationTimestamps.sort().at(-1);
      const latencyMs =
        origin?.timestamp && latestDestination
          ? Math.max(0, Date.parse(latestDestination) - Date.parse(origin.timestamp))
          : null;

      return {
        reactive_tx: reactiveTxHash,
        origin,
        automation: {
          chain_id: LASNA_CHAIN_ID,
          tx_hash: reactiveTxHash,
          ...automationFacts,
        },
        destinations,
        latency_ms: latencyMs,
        callbacks,
        mirrorRequests,
        leaderTransactions,
      };
    },
  };
}
