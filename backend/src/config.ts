import { z } from 'zod';

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
});

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
  return {
    ...data,
    corsOrigins: data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
