import type { Store } from '../db/store.js';

export interface ChainCursor {
  chain_id: number;
  last_block: number;
  last_block_hash: string;
  updated_at: string;
}

/** Thrown when a write would move a cursor backwards by more than the confirmation depth. */
export class CursorRegressionError extends Error {
  constructor(
    readonly chainId: number,
    readonly current: number,
    readonly proposed: number,
    readonly depth: number,
  ) {
    super(`Chain ${chainId}: cursor ${current} → ${proposed} regresses beyond depth ${depth}`);
    this.name = 'CursorRegressionError';
  }
}

/** Persisted per-chain block cursor. */
export class CursorStore {
  constructor(private readonly store: Store) {}

  async get(chainId: number): Promise<ChainCursor | null> {
    return (await this.store.selectOne('indexer_cursors', {
      chain_id: chainId,
    })) as ChainCursor | null;
  }

  async list(): Promise<ChainCursor[]> {
    return (await this.store.select(
      'indexer_cursors',
      {},
      {
        orderBy: { column: 'chain_id', ascending: true },
      },
    )) as unknown as ChainCursor[];
  }

  /**
   * Advances a cursor. A blocked-range restart may rewind at most `confirmationDepth` blocks;
   * anything further is a bug and is refused rather than silently replayed.
   */
  async set(
    cursor: Omit<ChainCursor, 'updated_at'>,
    confirmationDepth: number,
    force = false,
  ): Promise<void> {
    const existing = await this.get(cursor.chain_id);
    if (!force && existing && cursor.last_block < existing.last_block - confirmationDepth) {
      throw new CursorRegressionError(
        cursor.chain_id,
        existing.last_block,
        cursor.last_block,
        confirmationDepth,
      );
    }
    await this.store.upsert(
      'indexer_cursors',
      [{ ...cursor, updated_at: new Date().toISOString() }],
      'chain_id',
    );
  }

  /** Resets cursors to the configured start blocks during a reindex. */
  async reset(chainId: number, startBlock: number): Promise<void> {
    await this.set(
      { chain_id: chainId, last_block: startBlock, last_block_hash: '0x' + '0'.repeat(64) },
      0,
      true,
    );
  }
}
