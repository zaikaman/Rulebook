import type { AppConfig } from './config.js';
import type { TelegramService } from './telegram/service.js';
import type { RulewrightService } from './rulewright/service.js';
import type { AssistantService } from './assistant/service.js';

/** Everything the HTTP layer needs, injected so tests can run without Supabase or RPC. */
export interface ServerDeps {
  readonly config: AppConfig;
  readonly databaseReachable: () => Promise<boolean>;
  readonly rpcHealth: () => Promise<Array<{ chain_id: number; rpc_ok: boolean }>>;
  readonly telegram?: TelegramService;
  readonly rulewright?: RulewrightService;
  readonly assistant?: AssistantService;
}
