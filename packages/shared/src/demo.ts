import { z } from 'zod';

import { addressSchema, fundsChainIdSchema, networkModeSchema } from './schemas.js';
import { workflowIdSchema, workflowV2RunStatusSchema } from './workflows.js';

export const demoFeaturedRunLimit = 6;

export const demoFeaturedRunSchema = z.object({
  id: workflowIdSchema,
  workflowId: workflowIdSchema,
  title: z.string(),
  chain: fundsChainIdSchema,
  originChain: z.number().int(),
  status: workflowV2RunStatusSchema,
  path: z.number().int().nonnegative().nullable(),
});

export const demoAccountConfigSchema = z.object({
  available: z.boolean(),
  owner: addressSchema.nullable(),
  network: networkModeSchema,
  featuredRuns: z.array(demoFeaturedRunSchema).max(demoFeaturedRunLimit),
});

export const assistantDemoSessionSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  owner: addressSchema,
});

export type DemoFeaturedRun = z.infer<typeof demoFeaturedRunSchema>;
export type DemoAccountConfig = z.infer<typeof demoAccountConfigSchema>;
export type AssistantDemoSession = z.infer<typeof assistantDemoSessionSchema>;
