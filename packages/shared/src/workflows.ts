import { parseUnits, type Hex } from 'viem';
import { z } from 'zod';
import { fundsChainIdSchema } from './schemas.js';

export const workflowLimits = { nodes: 15, conditionDepth: 3, stepsPerPath: 3 } as const;

export function readAmount(value: string, decimals: number, name: string) {
  const text = value.trim();
  if (!text) throw new Error('Enter ' + name + '.');
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new Error(
      decimals === 0
        ? 'Enter ' + name + ' as a whole number.'
        : 'Enter ' + name + ' using digits and a decimal point.',
    );
  }
  if ((text.split('.')[1]?.length ?? 0) > decimals) {
    throw new Error('Use up to ' + decimals + ' decimal places for ' + name + '.');
  }
  return parseUnits(text, decimals);
}

export const workflowHexSchema = z
  .string()
  .regex(/^0x(?:[0-9a-f]{2})+$/i)
  .transform((hex) => hex as Hex);

export const workflowIdSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/i)
  .transform((hex) => hex.toLowerCase() as Hex);

export const workflowV2RunStatusSchema = z.enum([
  'pending',
  'confirmed',
  'skipped',
  'expired',
  'failed',
  'in grace period',
]);

export const workflowV2RunProofSchema = z.object({
  id: workflowIdSchema,
  chain: fundsChainIdSchema,
  programHash: workflowIdSchema,
  originChain: z.number().int(),
  originTransaction: workflowIdSchema,
  originLogIndex: z.string().regex(/^\d+$/),
  lasnaTransaction: workflowIdSchema,
  destinationTransaction: workflowIdSchema.nullable(),
  expiresAt: z.number().int().nonnegative().safe(),
  status: workflowV2RunStatusSchema,
  path: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
});

export type WorkflowV2RunProof = z.infer<typeof workflowV2RunProofSchema>;
