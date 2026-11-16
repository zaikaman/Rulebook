import type { AppConfig } from './config.js';
import type { Repositories } from './db/repositories/index.js';
import type { CursorStore } from './indexer/cursors.js';

/** Everything the HTTP layer needs, injected so tests can run without Supabase or RPC. */
export interface ServerDeps {
  readonly config: AppConfig;
  readonly repositories: Repositories;
  readonly cursors: CursorStore;
  readonly databaseReachable: () => Promise<boolean>;
  readonly rpcHealth: () => Promise<Array<{ chain_id: number; rpc_ok: boolean }>>;
}
