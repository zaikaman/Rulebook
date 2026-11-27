/**
 * Boundary schemas for everything that crosses the API. Every backend response and every
 * frontend fetch is parsed through these; types are inferred, never hand-written duplicates
 * (Constitution IV).
 */
import { zeroAddress } from 'viem';
import { z } from 'zod';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  NETWORK_MODES,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from './chains.js';

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

const MAX_UINT256 = (1n << 256n) - 1n;

/** uint256 as a decimal string, parsed to bigint, rejecting values above 2^256-1. */
export const uint256Schema = z
  .string()
  .regex(/^[0-9]+$/, 'uint256 must be a decimal string')
  .transform((value) => BigInt(value))
  .refine((value) => value <= MAX_UINT256, { message: 'uint256 overflow' });

export const templateIdSchema = z.number().int().min(1).max(13);
export const networkModeSchema = z.enum(NETWORK_MODES);
export const automationChainIdSchema = z.union([
  z.literal(LASNA_CHAIN_ID),
  z.literal(REACTIVE_MAINNET_CHAIN_ID),
]);
export const chainIdSchema = z.number().int().positive();
export const fundsChainIdSchema = z.union([
  z.literal(UNICHAIN_SEPOLIA_CHAIN_ID),
  z.literal(BASE_SEPOLIA_CHAIN_ID),
  z.literal(UNICHAIN_MAINNET_CHAIN_ID),
  z.literal(BASE_MAINNET_CHAIN_ID),
]);

export const workflowV2ChainDeploymentSchema = z
  .object({
    factory: addressSchema.refine(
      (factory) => factory !== zeroAddress,
      'Use the deployed factory address',
    ),
    startBlock: z.number().int().positive().safe(),
  })
  .strict();

export const workflowV2DeploymentSchema = z
  .object({
    lasna: workflowV2ChainDeploymentSchema,
    unichain: workflowV2ChainDeploymentSchema,
    base: workflowV2ChainDeploymentSchema.optional(),
  })
  .strict();

export const workflowV2MainnetDeploymentSchema = z
  .object({
    reactive: workflowV2ChainDeploymentSchema,
    unichain: workflowV2ChainDeploymentSchema,
    base: workflowV2ChainDeploymentSchema.optional(),
  })
  .strict();

export type WorkflowV2ChainDeployment = z.infer<typeof workflowV2ChainDeploymentSchema>;
export type WorkflowV2Deployment = z.infer<typeof workflowV2DeploymentSchema>;
export type WorkflowV2MainnetDeployment = z.infer<typeof workflowV2MainnetDeploymentSchema>;

export const callbackRecordSchema = z.object({
  block_number: z.number().int().nonnegative(),
  reacting_contract: addressSchema,
  callback_index: z.number().int().nonnegative(),
  destination_chain_id: chainIdSchema,
  destination_tx_hash: txHashSchema,
  error_data: z.string(),
});
export type CallbackRecord = z.infer<typeof callbackRecordSchema>;

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

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.string().nullable().optional(),
  }),
});
