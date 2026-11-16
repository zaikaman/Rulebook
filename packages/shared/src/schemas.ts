/**
 * Boundary schemas for everything that crosses the API. Every backend response and every
 * frontend fetch is parsed through these; types are inferred, never hand-written duplicates
 * (Constitution IV).
 */
import { z } from 'zod';

const MAX_UINT256 = (1n << 256n) - 1n;

/** EIP-55-agnostic address, normalised to lowercase. */
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'not an address')
  .transform((value) => value.toLowerCase() as `0x${string}`);
export type Address = z.infer<typeof addressSchema>;

/** 32-byte transaction hash. */
export const txHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'not a transaction hash')
  .transform((value) => value.toLowerCase() as `0x${string}`);
export type TxHash = z.infer<typeof txHashSchema>;

/** uint256 as a decimal string, parsed to bigint, rejecting values above 2^256-1. */
export const uint256Schema = z
  .string()
  .regex(/^[0-9]+$/, 'uint256 must be a decimal string')
  .transform((value) => BigInt(value))
  .refine((value) => value <= MAX_UINT256, { message: 'uint256 overflow' });
export type Uint256 = z.infer<typeof uint256Schema>;

export const templateIdSchema = z.number().int().min(1).max(13);
export const chainIdSchema = z.number().int().positive();
export const blockTimeSchema = z.string().datetime({ offset: true });

export const ruleStatusSchema = z.enum(['active', 'paused', 'cancelled']);
export const executionKindSchema = z.enum(['executed', 'mirrored']);
export const executionStatusSchema = z.enum(['confirmed', 'refused', 'pending']);
export const setupStateSchema = z.enum(['none', 'agent_only', 'partial', 'complete']);
export type SetupState = z.infer<typeof setupStateSchema>;
export const sponsorStateSchema = z.enum(['healthy', 'low', 'exhausted', 'debt']);
export const proofRoleSchema = z.enum(['origin', 'automation', 'destination']);
export const proofSourceSchema = z.enum(['chain', 'cache']);
export const authorBadgeSchema = z.enum(['team', 'community']);

export const cachedPriceSchema = z.object({
  price: uint256Schema,
  observed_at: blockTimeSchema,
});

export const ruleSchema = z.object({
  agent: addressSchema,
  rule_id: uint256Schema,
  template: templateIdSchema,
  chain_id: chainIdSchema,
  status: ruleStatusSchema,
  latched: z.boolean(),
  pair: addressSchema.optional(),
  token_in: addressSchema.optional(),
  token_out: addressSchema.optional(),
  amount_in: uint256Schema.optional(),
  threshold: uint256Schema.optional(),
  secondary: uint256Schema.optional(),
  runs: z.number().int().nonnegative(),
  last_run_at: blockTimeSchema.nullable().optional(),
  is_public: z.boolean().default(false),
  cached_price: cachedPriceSchema.nullable().optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const executionSchema = z.object({
  chain_id: chainIdSchema,
  tx_hash: txHashSchema,
  vault: addressSchema,
  agent: addressSchema,
  rule_id: uint256Schema,
  kind: executionKindSchema,
  token_in: addressSchema.optional(),
  token_out: addressSchema.optional(),
  amount_in: uint256Schema.optional(),
  amount_out: uint256Schema.optional(),
  block_time: blockTimeSchema,
  leader_tx: txHashSchema.optional(),
  /** Reactive transaction that produced this destination execution, when known. */
  reactive_tx_hash: txHashSchema.optional(),
  status: executionStatusSchema.default('confirmed'),
});
export type Execution = z.infer<typeof executionSchema>;

export const callbackRecordSchema = z.object({
  block_number: z.number().int().nonnegative(),
  reacting_contract: addressSchema,
  callback_index: z.number().int().nonnegative(),
  destination_chain_id: chainIdSchema,
  destination_tx_hash: txHashSchema,
  error_data: z.string(),
});
export type CallbackRecord = z.infer<typeof callbackRecordSchema>;

export const proofErrorSchema = z.object({
  selector: z.string(),
  message: z.string(),
  human: z.string(),
});

export const proofRowSchema = z.object({
  role: proofRoleSchema,
  chain_id: chainIdSchema,
  tx_hash: txHashSchema,
  block_number: z.number().int().optional(),
  timestamp: blockTimeSchema.optional(),
  explorer_url: z.string().url(),
  error: proofErrorSchema.nullable().optional(),
});
export type ProofRow = z.infer<typeof proofRowSchema>;

export const proofSchema = z.object({
  reactive_tx: txHashSchema,
  source: proofSourceSchema,
  cache_age_seconds: z.number().int().nullable().optional(),
  latency_ms: z.number().int().nullable().optional(),
  rows: z.array(proofRowSchema).min(1),
});
export type Proof = z.infer<typeof proofSchema>;

export const listingSchema = z.object({
  listing_id: uint256Schema,
  agent: addressSchema,
  rule_id: uint256Schema,
  template: templateIdSchema,
  author: addressSchema,
  author_badge: authorBadgeSchema.default('community'),
  name: z.string().optional(),
  description: z.string().optional(),
  runs: z.number().int().nonnegative(),
  success_rate: z.number().min(0).max(1),
  cloned_count: z.number().int().nonnegative().default(0),
});
export type Listing = z.infer<typeof listingSchema>;

export const accountAgentSchema = z.object({
  address: addressSchema,
  created_tx: txHashSchema,
  active_rules: z.number().int().nonnegative(),
});

export const vaultSchema = z.object({
  address: addressSchema,
  chain_id: chainIdSchema,
  connected: z.boolean(),
  paused: z.boolean(),
  mirror_mode: z.boolean(),
  max_spend_per_run: uint256Schema.optional(),
});

export const accountSchema = z.object({
  owner: addressSchema,
  agent: accountAgentSchema.nullable(),
  vaults: z.array(vaultSchema),
  setup_state: setupStateSchema,
});
export type Account = z.infer<typeof accountSchema>;

export const onboardingStepSchema = z.object({
  name: z.enum(['agent', 'vault', 'link', 'fund_credit']),
  status: z.enum(['skipped', 'submitted', 'confirmed', 'failed']),
  tx_hash: txHashSchema.optional(),
  chain_id: chainIdSchema.optional(),
  error: z.string().nullable().optional(),
});
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const onboardingResponseSchema = z.object({
  setup_state: setupStateSchema,
  steps: z.array(onboardingStepSchema),
  agent: addressSchema.optional(),
  vault: addressSchema.optional(),
});
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;

export const starterFundsResponseSchema = z.object({
  tx_hash: txHashSchema,
  tx_hashes: z.array(txHashSchema).optional(),
  amount_usdc: uint256Schema,
  amount_weth: uint256Schema,
});
export type StarterFundsResponse = z.infer<typeof starterFundsResponseSchema>;

export const sponsorChainSchema = z.object({
  chain_id: chainIdSchema,
  reserves: uint256Schema,
  debt: uint256Schema,
  state: sponsorStateSchema,
});

export const sponsorStatusSchema = z.object({
  agent: addressSchema,
  chains: z.array(sponsorChainSchema),
});
export type SponsorStatus = z.infer<typeof sponsorStatusSchema>;

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  indexer: z.object({
    enabled: z.boolean(),
    lag_seconds: z.number().int().nonnegative(),
    cursors: z.array(
      z.object({
        chain_id: chainIdSchema,
        last_block: z.number().int().nonnegative(),
        updated_at: z.string(),
      }),
    ),
  }),
  database: z.object({
    reachable: z.boolean(),
    paused_hint: z.string().nullable(),
  }),
  chains: z.array(
    z.object({
      chain_id: chainIdSchema,
      rpc_ok: z.boolean(),
    }),
  ),
  dead_letter: z
    .object({
      count: z.number().int().nonnegative(),
    })
    .optional(),
});
export type Health = z.infer<typeof healthSchema>;

export const templateSlotSchema = z.object({
  key: z.string(),
  kind: z.enum(['schedule', 'amount', 'token', 'price', 'percent', 'duration', 'address']),
  label: z.string(),
  required: z.boolean(),
  min: z.string().nullable().optional(),
  max: z.string().nullable().optional(),
});

export const templateSchema = z.object({
  id: templateIdSchema,
  name: z.string(),
  category: z.enum(['trading', 'personal', 'alert']),
  sentence: z.string(),
  slots: z.array(templateSlotSchema),
});
export type TemplateSummary = z.infer<typeof templateSchema>;

export const chainSchema = z.object({
  chain_id: chainIdSchema,
  name: z.string(),
  role: z.enum(['automation', 'funds']),
  explorer: z.string().url(),
  is_origin: z.boolean(),
  is_destination: z.boolean(),
  supported_templates: z.array(templateIdSchema).optional(),
});
export type Chain = z.infer<typeof chainSchema>;

export const chainsResponseSchema = z.object({
  chains: z.array(chainSchema),
  templates: z.array(templateSchema),
});

export const rulesResponseSchema = z.object({ rules: z.array(ruleSchema) });

export const ruleDetailResponseSchema = z.object({
  rule: ruleSchema,
  recent_executions: z.array(executionSchema),
});

export const executionsResponseSchema = z.object({
  executions: z.array(executionSchema),
  next_cursor: z.string().nullable().optional(),
});

export const listingsResponseSchema = z.object({
  listings: z.array(listingSchema),
  next_cursor: z.string().nullable().optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.string().nullable().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const encodePreviewResponseSchema = z.object({
  to: addressSchema,
  data: z.string().regex(/^0x[fF0-9a-fA-F]*$/, 'not calldata'),
  readable_sentence: z.string(),
  missing_slots: z.array(z.string()).default([]),
});
export type EncodePreviewResponse = z.infer<typeof encodePreviewResponseSchema>;
