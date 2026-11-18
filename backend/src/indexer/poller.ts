import { agentAbi } from '@rulebook/shared';
import type { PublicClient } from 'viem';

import type { Repositories } from '../db/repositories/index.js';
import type { Store } from '../db/store.js';
import { clientFor, type ChainClients } from '../chain/clients.js';
import { CursorStore, type ChainCursor } from './cursors.js';
import {
  decodeLog,
  isKnownTopic,
  persistDecodedEvent,
  type RawLog,
  type RuleSnapshot,
} from './decoders/index.js';
import { recordDeadLetter } from './deadLetter.js';

export interface PollerOptions {
  readonly repositories: Repositories;
  readonly store: Store;
  readonly cursors: CursorStore;
  readonly clients: ChainClients;
  readonly startBlocks: Readonly<Record<number, number>>;
  readonly confirmationDepth: Readonly<Record<number, number>>;
  readonly rangeSize?: number;
  readonly pollIntervalMs?: number;
}

/**
 * Cursor-driven log poller. Each poll reads one bounded range ending `confirmationDepth` blocks
 * behind the head, decodes and persists it, then advances the cursor. A failed range is retried
 * with exponential backoff; undecodable known-topic logs go to the dead-letter table.
 */
export class IndexerPoller {
  private readonly rangeSize: number;
  private readonly pollIntervalMs: number;
  private readonly cursors: CursorStore;
  private running = false;

  constructor(private readonly options: PollerOptions) {
    this.rangeSize = options.rangeSize ?? 2_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.cursors = options.cursors;
  }

  /** Polls one chain once; returns the number of logs processed. */
  async pollOnce(chainId: number, headOverride?: bigint): Promise<number> {
    const client = clientFor(this.options.clients, chainId);
    const depth = BigInt(this.options.confirmationDepth[chainId] ?? 12);
    const head = headOverride ?? (await client.getBlockNumber());
    const safeHead = head > depth ? head - depth : 0n;
    const cursor = await this.cursors.get(chainId);
    const start = cursor?.last_block ?? this.options.startBlocks[chainId] ?? 0;
    const fromBlock = BigInt(start) + 1n;
    if (fromBlock > safeHead) return 0;

    const toBlock =
      fromBlock + BigInt(this.rangeSize) - 1n > safeHead
        ? safeHead
        : fromBlock + BigInt(this.rangeSize) - 1n;

    const logs = await client.getLogs({ fromBlock, toBlock });
    let processed = 0;
    for (const log of logs) {
      const raw: RawLog = {
        chainId,
        address: log.address,
        topics: log.topics,
        data: log.data,
        blockNumber: log.blockNumber ?? fromBlock,
        transactionHash: log.transactionHash ?? '0x' + '0'.repeat(64),
        logIndex: log.logIndex ?? 0,
      };
      const outcome = decodeLog(raw);
      if (outcome.ok) {
        await persistDecodedEvent(this.options.repositories, outcome.event, {
          readRule: (chainId, agent, ruleId) => this.readRule(chainId, agent, ruleId),
        });
        processed += 1;
      } else if (outcome.known || (raw.topics[0] && isKnownTopic(chainId, raw.topics[0]))) {
        await recordDeadLetter(this.options.repositories, raw, outcome.reason);
      }
    }

    const next: Omit<ChainCursor, 'updated_at'> = {
      chain_id: chainId,
      last_block: Number(toBlock),
      last_block_hash: await this.blockHash(client, toBlock),
    };
    await this.cursors.set(next, Number(depth));
    return processed;
  }

  /** Runs every configured chain until `stop()` is called. */
  async run(
    chainIds: readonly number[] = Object.keys(this.options.startBlocks).map(Number),
  ): Promise<void> {
    this.running = true;
    let backoffMs = 1_000;
    while (this.running) {
      try {
        for (const chainId of chainIds) {
          if (!this.running) return;
          await this.pollOnce(chainId);
        }
        backoffMs = 1_000;
        await sleep(this.pollIntervalMs);
      } catch {
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  /** Requests a graceful shutdown between ranges. */
  stop(): void {
    this.running = false;
  }

  private async blockHash(client: PublicClient, blockNumber: bigint): Promise<string> {
    try {
      const block = await client.getBlock({ blockNumber });
      return block.hash;
    } catch {
      return '0x' + '0'.repeat(64);
    }
  }

  /**
   * Backfills the rule parameters a chain-created rule owns. A failure (historical state,
   * transient RPC error) leaves the row null rather than dropping the rule: the next replay
   * can fill it in.
   */
  private async readRule(
    chainId: number,
    agent: string,
    ruleId: bigint,
  ): Promise<RuleSnapshot | null> {
    const client = clientFor(this.options.clients, chainId);
    const rule = await client.readContract({
      address: agent as `0x${string}`,
      abi: agentAbi,
      functionName: 'getRule',
      args: [ruleId],
    });
    return {
      template: Number(rule.template),
      chainId: Number(rule.chainId),
      pair: rule.pair,
      tokenIn: rule.tokenIn,
      tokenOut: rule.tokenOut,
      amountIn: rule.amountIn.toString(),
      threshold: rule.threshold.toString(),
      secondary: rule.secondary.toString(),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
