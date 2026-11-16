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
import { SupabaseStore } from '../db/store.js';
import { CursorStore } from './cursors.js';
import { IndexerPoller } from './poller.js';

export const DERIVED_TABLES = [
  'executions',
  'rule_events',
  'rules',
  'vaults',
  'agents',
  'callbacks',
  'mirrors',
  'price_observations',
  'sponsor_ledger',
  'dead_letter',
] as const;

export interface ReindexDeps {
  store: SupabaseStore;
  cursors: CursorStore;
  poller: IndexerPoller;
  startBlocks: Readonly<Record<number, number>>;
}

/** Truncates derived state, resets cursors, and replays every configured chain. */
export async function reindex(deps: ReindexDeps): Promise<void> {
  await deps.store.truncate(DERIVED_TABLES);
  for (const [chainId, startBlock] of Object.entries(deps.startBlocks)) {
    await deps.cursors.reset(Number(chainId), startBlock);
  }
  for (const chainId of Object.keys(deps.startBlocks).map(Number)) {
    let idlePolls = 0;
    while (idlePolls < 2) {
      const processed = await deps.poller.pollOnce(chainId);
      idlePolls = processed === 0 ? idlePolls + 1 : 0;
    }
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
