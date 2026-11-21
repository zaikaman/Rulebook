import type { ProofSource } from './chain/proofSource.js';
import type { SponsorSource } from './chain/sponsorSource.js';
import type { AppConfig } from './config.js';
import type { Repositories } from './db/repositories/index.js';
import type { CursorStore } from './indexer/cursors.js';
import type { AccountChain } from './sponsor/accountChain.js';
import type { TelegramService } from './telegram/service.js';
import type { RulewrightService } from './rulewright/service.js';

/** Everything the HTTP layer needs, injected so tests can run without Supabase or RPC. */
export interface ServerDeps {
  readonly config: AppConfig;
  readonly repositories: Repositories;
  readonly cursors: CursorStore;
  readonly databaseReachable: () => Promise<boolean>;
  readonly rpcHealth: () => Promise<Array<{ chain_id: number; rpc_ok: boolean }>>;
  /** Read-only chain facts used to derive `setup_state` and check vault ownership. */
  readonly accountChain: AccountChain;
  /** Chain-first proof reader; absent in tests that exercise the cache-only fallback. */
  readonly proofSource?: ProofSource;
  /** Reads execution-credit reserves/debt; absent when no chain client is configured. */
  readonly sponsorSource?: SponsorSource;
  readonly telegram?: TelegramService;
  readonly rulewright?: RulewrightService;
}
