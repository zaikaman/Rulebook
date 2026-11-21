import { addressSchema, type Address } from '@rulebook/shared';
import { zeroAddress } from 'viem';
import { z } from 'zod';
import type { WorkflowDeployment } from './workflows/indexer.js';
import type { WorkflowV2Deployment } from './workflows/indexerV2.js';

const v2ChainDeployment = z
  .object({
    factory: addressSchema.refine(
      (factory) => factory !== zeroAddress,
      'Use the deployed factory address',
    ),
    startBlock: z.number().int().positive().safe(),
  })
  .strict();

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
  .pipe(
    z
      .object({
        lasna: v2ChainDeployment,
        unichain: v2ChainDeployment,
      })
      .strict(),
  );

const archivedDeploymentsJson = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a JSON array of factory addresses' });
      return z.NEVER;
    }
  })
  .pipe(z.array(addressSchema.refine((factory) => factory !== zeroAddress)));

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
  INDEXER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  INDEXER_START_BLOCK_LASNA: z.coerce.number().int().nonnegative().default(0),
  INDEXER_START_BLOCK_UNICHAIN: z.coerce.number().int().nonnegative().default(0),
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
  WORKFLOW_DIRECTORY_ADDRESS: addressSchema.optional(),
  WORKFLOW_VAULT_FACTORY_ADDRESS: addressSchema.optional(),
  WORKFLOW_START_BLOCK_LASNA: z.coerce.number().int().positive().optional(),
  WORKFLOW_START_BLOCK_UNICHAIN: z.coerce.number().int().positive().optional(),
  WORKFLOW_V2_DEPLOYMENT: workflowV2DeploymentJson.optional(),
  WORKFLOW_V2_ARCHIVED_DEPLOYMENTS: archivedDeploymentsJson.optional(),
  GEMINI_MODEL: z.string().optional(),
  GEMINI_BASE_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
});

export interface GeminiConfig {
  readonly model: string;
  readonly endpoint: URL;
  readonly apiKey: string;
}

export interface TelegramConfig {
  readonly botToken: string;
  readonly botUsername: string;
  readonly webhookSecret: string;
  readonly appOrigin: string;
  readonly factories: readonly Address[];
  readonly updates?: 'webhook' | 'polling';
}

export interface AppConfig {
  readonly PORT: number;
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly SUPABASE_URL: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly LASNA_RPC_URL: string;
  readonly UNICHAIN_RPC_URL: string;
  readonly INDEXER_ENABLED: boolean;
  readonly INDEXER_START_BLOCK_LASNA: number;
  readonly INDEXER_START_BLOCK_UNICHAIN: number;
  readonly corsOrigins: readonly string[];
  readonly telegram?: TelegramConfig;
  readonly workflows?: WorkflowDeployment;
  readonly workflowsV2?: WorkflowV2Deployment;
  /** Factory addresses whose public run proofs stay readable after a cutover. */
  readonly workflowV2Archived: readonly Address[];
  readonly gemini?: GeminiConfig;
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
    WORKFLOW_DIRECTORY_ADDRESS: directory,
    WORKFLOW_VAULT_FACTORY_ADDRESS: vaultFactory,
    WORKFLOW_START_BLOCK_LASNA: lasnaStart,
    WORKFLOW_START_BLOCK_UNICHAIN: unichainStart,
    WORKFLOW_V2_DEPLOYMENT: workflowsV2,
    WORKFLOW_V2_ARCHIVED_DEPLOYMENTS: archivedWorkflowV2Deployments,
    GEMINI_MODEL: geminiModel,
    GEMINI_BASE_URL: geminiBase,
    GEMINI_API_KEY: geminiKey,
    ...base
  } = data;
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
    const configuredFactories = factoryList?.trim()
      ? factoryList.split(',').map((address) => address.trim())
      : [];
    if (workflowsV2) configuredFactories.push(workflowsV2.lasna.factory);
    const factories = z
      .array(addressSchema.refine((address) => address !== zeroAddress))
      .nonempty()
      .safeParse(configuredFactories);
    if (!factories.success)
      throw new ConfigError([
        'Configure WORKFLOW_V2_DEPLOYMENT or list trusted Lasna factories in TELEGRAM_AGENT_FACTORIES',
      ]);
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
      factories: [...new Set(factories.data)],
      updates: telegramUpdates,
    };
  }
  return {
    ...base,
    corsOrigins,
    telegram,
    workflowsV2,
    workflowV2Archived: archivedWorkflowV2Deployments ?? [],
    gemini,
    workflows:
      directory && vaultFactory && lasnaStart && unichainStart
        ? { directory, vaultFactory, lasnaStart, unichainStart }
        : undefined,
  };
}
