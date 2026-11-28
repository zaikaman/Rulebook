import { z } from 'zod';

import { addressSchema, fundsChainIdSchema, networkModeSchema } from './schemas.js';
import { workflowIdSchema } from './workflows.js';

export const workflowArchiveStateSchema = z.object({
  archived: z.boolean(),
  revision: z.number().int().nonnegative().safe(),
  epoch: z
    .string()
    .regex(/^[1-9]\d{0,19}$/)
    .nullable(),
});

export const workflowArchiveRequestSchema = z.object({
  owner: addressSchema,
  network: networkModeSchema,
  chain: fundsChainIdSchema,
  workflow: workflowIdSchema,
  action: z.enum(['archive', 'restore']),
  revision: workflowArchiveStateSchema.shape.revision,
  epoch: workflowArchiveStateSchema.shape.epoch.unwrap(),
  expires: z.number().int().positive().safe(),
});

export function workflowArchiveMessage(
  request: z.infer<typeof workflowArchiveRequestSchema>,
  origin: string,
  deployment: string,
) {
  return [
    `Rulebook asks you to ${request.action} a workflow.`,
    '',
    `App: ${origin}`,
    `Wallet: ${request.owner.toLowerCase()}`,
    `Network: ${request.network}`,
    `Deployment: ${deployment}`,
    `Settlement chain: ${request.chain}`,
    `Workflow ID: ${request.workflow.toLowerCase()}`,
    `Workflow version: ${request.epoch}`,
    `Archive revision: ${request.revision}`,
    `Expires: ${new Date(request.expires * 1000).toISOString()}`,
  ].join('\n');
}

export const workflowActivityFilterSchema = z.enum(['all', 'pending', 'confirmed', 'other']);
export const workflowActivityStatuses = {
  pending: ['pending', 'in grace period'],
  confirmed: ['confirmed'],
  other: ['skipped', 'failed', 'expired'],
} as const;

export const workflowListPageSchema = z.object({
  items: z.array(z.object({ id: workflowIdSchema, chain: fundsChainIdSchema })),
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
  syncing: z.boolean(),
});
