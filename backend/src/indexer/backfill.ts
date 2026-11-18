#!/usr/bin/env node
/**
 * Rebuilds the read model from chain logs. Truncates every derived table, resets cursors to the
 * configured start blocks, and replays until each chain is caught up. This is the executable
 * form of the Constitution V "rebuild from chain events" runbook.
 */
import { loadConfig } from '../config.js';
import { createChainClients } from '../chain/clients.js';
import { createServiceClient } from '../db/client.js';
import { createRepositories } from '../db/repositories/index.js';
import { SupabaseStore, type Store } from '../db/store.js';
import { CursorStore } from './cursors.js';
import { IndexerPoller } from './poller.js';

// Delete dependents before deleting agents. Each filter uses a non-null primary key column.
const DERIVED_TABLES = {
  executions: 'tx_hash',
  rule_events: 'tx_hash',
  rules: 'agent',
  vaults: 'address',
  agents: 'address',
  callbacks: 'reactive_tx_hash',
  mirrors: 'follower_agent',
  price_observations: 'pair',
  sponsor_ledger: 'tx_hash',
  dead_letter: 'tx_hash',
};

export interface ReindexDeps {
  store: Store;
  cursors: CursorStore;
  poller: Pick<IndexerPoller, 'pollOnce'>;
  startBlocks: Readonly<Record<number, number>>;
}

/** Truncates derived state, resets cursors, and replays every configured chain. */
export async function reindex(deps: ReindexDeps): Promise<void> {
  await deps.store.truncate(DERIVED_TABLES);
  await deps.store.deleteWhere('listings', { author_badge: 'community' });
  for (const [chainId, startBlock] of Object.entries(deps.startBlocks)) {
    await deps.cursors.reset(Number(chainId), startBlock);
  }
  for (const chainId of Object.keys(deps.startBlocks).map(Number)) {
    let previousBlock: number | undefined;
    let currentBlock = (await deps.cursors.get(chainId))?.last_block;
    do {
      previousBlock = currentBlock;
      await deps.poller.pollOnce(chainId);
      currentBlock = (await deps.cursors.get(chainId))?.last_block;
    } while (currentBlock !== previousBlock);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new SupabaseStore(createServiceClient(config));
  const repositories = createRepositories(store);
  const cursors = new CursorStore(store);
  const startBlocks = {
    5_318_007: config.INDEXER_START_BLOCK_LASNA,
    1301: config.INDEXER_START_BLOCK_UNICHAIN,
  };
  const poller = new IndexerPoller({
    repositories,
    store,
    cursors,
    clients: createChainClients(config),
    startBlocks,
    confirmationDepth: { 5_318_007: 20, 1301: 12 },
    rangeSize: 1_000,
  });
  await reindex({ store, cursors, poller, startBlocks });
  console.log('Reindex complete.');
}

if (process.argv[1]?.endsWith('backfill.ts')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
