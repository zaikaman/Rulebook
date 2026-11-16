import type { DeadLetterRow, Repositories } from '../db/repositories/index.js';

/** Minimal log shape needed to identify a dead letter. */
export interface DeadLetterSource {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly topics: readonly string[];
  readonly data: string;
}

/** Builds the row for an undecodable known-topic log. */
export function deadLetterRow(source: DeadLetterSource, reason: string): DeadLetterRow {
  return {
    id: `${source.chainId}:${source.transactionHash}:${source.logIndex}`,
    chain_id: source.chainId,
    block_number: Number(source.blockNumber),
    tx_hash: source.transactionHash,
    log_index: source.logIndex,
    reason,
    payload: JSON.stringify({ topics: source.topics, data: source.data }),
    recorded_at: new Date().toISOString(),
  };
}

/** Records an undecodable log so it is visible in `/health`, never silently dropped. */
export async function recordDeadLetter(
  repositories: Repositories,
  source: DeadLetterSource,
  reason: string,
): Promise<void> {
  await repositories.deadLetter.record(deadLetterRow(source, reason));
}
