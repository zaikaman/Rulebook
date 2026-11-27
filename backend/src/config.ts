import {
  addressSchema,
  automationChainIdSchema,
  demoFeaturedRunLimit,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  workflowIdSchema,
  workflowV2DeploymentSchema,
  workflowV2MainnetDeploymentSchema,
  type Address,
  type AutomationChainId,
  type WorkflowV2Deployment,
  type WorkflowV2MainnetDeployment,
} from '@rulebook/shared';
import { zeroAddress, type Hex } from 'viem';
import { z } from 'zod';

const workflowV2DeploymentJson = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a JSON deployment configuration' });
      return z.NEVER;
    }
  })
  .pipe(workflowV2DeploymentSchema);

const workflowV2MainnetDeploymentJson = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a JSON mainnet deployment configuration' });
      return z.NEVER;
    }
  })
  .pipe(workflowV2MainnetDeploymentSchema);

/**
 * Every environment variable the backend reads. Validation happens once, at boot, so a missing
 * variable fails loudly instead of turning into a silent `undefined` deep in the indexer.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  LASNA_RPC_URL: z.string().url().default('https://lasna-rpc.rnk.dev/'),
  UNICHAIN_RPC_URL: z.string().url().default('https://sepolia.unichain.org'),
  BASE_SEPOLIA_RPC_URL: z.string().url().default('https://sepolia.base.org'),
  REACTIVE_MAINNET_RPC_URL: z.string().url().default('https://mainnet-rpc.rnk.dev/'),
  UNICHAIN_MAINNET_RPC_URL: z.string().url().default('https://mainnet.unichain.org'),
  BASE_MAINNET_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  INDEXER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]+$/)
    .optional(),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{5,32}$/)
    .optional(),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,256}$/)
    .optional(),
  TELEGRAM_APP_ORIGIN: z.string().url().optional(),
  TELEGRAM_AGENT_FACTORIES: z.string().optional(),
  TELEGRAM_UPDATES: z.enum(['webhook', 'polling']).default('webhook'),
  WORKFLOW_V2_DEPLOYMENT: workflowV2DeploymentJson.optional(),
  WORKFLOW_V2_MAINNET_DEPLOYMENT: workflowV2MainnetDeploymentJson.optional(),
  GEMINI_MODEL: z.string().optional(),
  GEMINI_BASE_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  DEMO_ACCOUNT_ADDRESS: addressSchema.refine((address) => address !== zeroAddress).optional(),
  DEMO_FEATURED_RUN_IDS: z.string().optional(),
});

export interface GeminiConfig {
  readonly model: string;
  readonly endpoint: URL;
  readonly apiKey: string;
}

export interface TelegramFactoryTarget {
  readonly chainId: AutomationChainId;
  readonly address: Address;
}

export interface TelegramConfig {
  readonly botToken: string;
  readonly botUsername: string;
  readonly webhookSecret: string;
  readonly appOrigin: string;
  readonly factories: readonly Address[];
  readonly factoryTargets: readonly TelegramFactoryTarget[];
  readonly updates?: 'webhook' | 'polling';
}

export interface AppConfig {
  readonly PORT: number;
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly SUPABASE_URL: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly LASNA_RPC_URL: string;
  readonly UNICHAIN_RPC_URL: string;
  readonly BASE_SEPOLIA_RPC_URL: string;
  readonly REACTIVE_MAINNET_RPC_URL: string;
  readonly UNICHAIN_MAINNET_RPC_URL: string;
  readonly BASE_MAINNET_RPC_URL: string;
  readonly INDEXER_ENABLED: boolean;
  readonly corsOrigins: readonly string[];
  readonly telegram?: TelegramConfig;
  readonly workflowsV2?: WorkflowV2Deployment;
  readonly workflowsV2Mainnet?: WorkflowV2MainnetDeployment;
  readonly gemini?: GeminiConfig;
  readonly demoAccount?: Address;
  readonly demoFeaturedRunIds?: readonly Hex[];
}

/** Error thrown when the environment is incomplete or malformed. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

/** Parses `env` (defaults to `process.env`) into a validated config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  const data = parsed.data;
  const {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_BOT_USERNAME: botUsername,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    TELEGRAM_APP_ORIGIN: appOrigin,
    TELEGRAM_AGENT_FACTORIES: factoryList,
    TELEGRAM_UPDATES: telegramUpdates,
    WORKFLOW_V2_DEPLOYMENT: workflowsV2,
    WORKFLOW_V2_MAINNET_DEPLOYMENT: workflowsV2Mainnet,
    GEMINI_MODEL: geminiModel,
    GEMINI_BASE_URL: geminiBase,
    GEMINI_API_KEY: geminiKey,
    DEMO_ACCOUNT_ADDRESS: demoAccount,
    DEMO_FEATURED_RUN_IDS: demoFeaturedRunIdsRaw,
    ...base
  } = data;
  let demoFeaturedRunIds: readonly Hex[] | undefined;
  if (demoFeaturedRunIdsRaw?.trim()) {
    const parsedIds = demoFeaturedRunIdsRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parsedId = workflowIdSchema.safeParse(entry);
        if (!parsedId.success) {
          throw new ConfigError([`Invalid run ID in DEMO_FEATURED_RUN_IDS entry "${entry}"`]);
        }
        return parsedId.data;
      });
    const uniqueIds = [...new Set(parsedIds)].slice(0, demoFeaturedRunLimit);
    if (uniqueIds.length > 0) {
      demoFeaturedRunIds = uniqueIds;
    }
  }
  const corsOrigins = base.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  let gemini: GeminiConfig | undefined;
  if (geminiModel?.trim() && geminiKey?.trim() && geminiBase) {
    const endpoint = URL.parse(geminiBase);
    if (
      endpoint?.protocol === 'https:' &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash
    ) {
      const path = endpoint.pathname.replace(/\/+$/, '');
      endpoint.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
      gemini = { model: geminiModel.trim(), apiKey: geminiKey.trim(), endpoint };
    }
  }
  let telegram: TelegramConfig | undefined;
  if (
    botToken ||
    botUsername ||
    webhookSecret ||
    appOrigin ||
    factoryList ||
    telegramUpdates === 'polling'
  ) {
    if (!botToken || !botUsername || !webhookSecret || !appOrigin) {
      throw new ConfigError(['Set all TELEGRAM_* configuration values together']);
    }
    const rawTargets: Array<{ chainId: AutomationChainId; address: string }> = [];
    if (factoryList?.trim()) {
      for (const entry of factoryList
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        const colon = entry.indexOf(':');
        if (colon === -1) {
          rawTargets.push({ chainId: LASNA_CHAIN_ID, address: entry });
        } else {
          const parsedChain = automationChainIdSchema.safeParse(Number(entry.slice(0, colon)));
          if (!parsedChain.success) {
            throw new ConfigError([
              `Invalid chain id in TELEGRAM_AGENT_FACTORIES entry "${entry}" (use ${LASNA_CHAIN_ID} or ${REACTIVE_MAINNET_CHAIN_ID})`,
            ]);
          }
          rawTargets.push({ chainId: parsedChain.data, address: entry.slice(colon + 1).trim() });
        }
      }
    }
    if (workflowsV2)
      rawTargets.push({ chainId: LASNA_CHAIN_ID, address: workflowsV2.lasna.factory });
    if (workflowsV2Mainnet) {
      rawTargets.push({
        chainId: REACTIVE_MAINNET_CHAIN_ID,
        address: workflowsV2Mainnet.reactive.factory,
      });
    }
    const parsedTargets = z
      .array(
        z.object({
          chainId: automationChainIdSchema,
          address: addressSchema.refine((address) => address !== zeroAddress),
        }),
      )
      .nonempty()
      .safeParse(rawTargets);
    if (!parsedTargets.success)
      throw new ConfigError([
        'Configure WORKFLOW_V2_DEPLOYMENT, WORKFLOW_V2_MAINNET_DEPLOYMENT, or list trusted factories in TELEGRAM_AGENT_FACTORIES (optional <chainId>:0x...)',
      ]);
    const uniqueTargets = new Map<string, TelegramFactoryTarget>();
    for (const target of parsedTargets.data) {
      uniqueTargets.set(`${target.chainId}:${target.address}`, target);
    }
    const factoryTargets = [...uniqueTargets.values()];
    const url = new URL(appOrigin);
    if (
      telegramUpdates === 'polling' &&
      (base.NODE_ENV !== 'development' || url.hostname !== 'localhost')
    ) {
      throw new ConfigError(['Telegram polling requires a localhost frontend in development']);
    }
    if (
      url.origin !== appOrigin ||
      !corsOrigins.includes(appOrigin) ||
      (url.protocol !== 'https:' &&
        (base.NODE_ENV === 'production' ||
          url.protocol !== 'http:' ||
          url.hostname !== 'localhost'))
    ) {
      throw new ConfigError([
        'TELEGRAM_APP_ORIGIN must be an allowed HTTPS origin (localhost HTTP is accepted for development)',
      ]);
    }
    telegram = {
      botToken,
      botUsername,
      webhookSecret,
      appOrigin,
      factories: [...new Set(factoryTargets.map((target) => target.address))],
      factoryTargets,
      updates: telegramUpdates,
    };
  }
  return {
    ...base,
    corsOrigins,
    telegram,
    workflowsV2,
    workflowsV2Mainnet,
    gemini,
    demoAccount,
    demoFeaturedRunIds,
  };
}
