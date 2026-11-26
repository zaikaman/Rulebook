import { z } from 'zod';

import { automationChainFor, getChain } from './chains.js';
import { addressSchema, networkModeSchema, txHashSchema } from './schemas.js';
import { workflowIdSchema } from './workflows.js';

export const assistantMessageLimit = 2000;
export const assistantHistoryLimit = 12;
export const assistantDailyLimit = 80;

export const assistantChallengeSchema = z.object({
  nonce: txHashSchema,
  owner: addressSchema,
  origin: z.string().url(),
  network: networkModeSchema,
  expiresAt: z.number().int().positive(),
});

export const assistantSessionSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const assistantConversationIdSchema = z.string().uuid();

/**
 * The current screen is a hint, never account data. The model must call a read-only tool before
 * it states a balance, run, workflow, listing, or notification fact.
 */
export const assistantPageSchema = z
  .object({
    path: z.string().trim().min(1).max(240),
    workflowId: workflowIdSchema.optional(),
  })
  .strict();

export const assistantRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(assistantMessageLimit),
    conversationId: assistantConversationIdSchema.optional(),
    page: assistantPageSchema.optional(),
    network: networkModeSchema.optional(),
  })
  .strict();

export const assistantReferenceSchema = z
  .object({
    kind: z.enum(['workflow', 'run', 'listing', 'account', 'activity']),
    id: z.string().trim().max(120),
    label: z.string().trim().min(1).max(120),
    href: z.string().trim().startsWith('/').max(300),
  })
  .strict();

export const assistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), label: z.string().min(1).max(120) }).strict(),
  z
    .object({
      type: z.literal('tool'),
      name: z.string().min(1).max(64),
      label: z.string().min(1).max(120),
      state: z.enum(['start', 'done', 'error']),
      detail: z.string().max(160).optional(),
    })
    .strict(),
  z.object({ type: z.literal('delta'), text: z.string().min(1).max(16_000) }).strict(),
  z
    .object({
      type: z.literal('done'),
      conversationId: assistantConversationIdSchema,
      references: z.array(assistantReferenceSchema).max(6),
    })
    .strict(),
  z.object({ type: z.literal('error'), message: z.string().min(1).max(500) }).strict(),
]);

export type AssistantChallenge = z.infer<typeof assistantChallengeSchema>;
export type AssistantPage = z.infer<typeof assistantPageSchema>;
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
export type AssistantReference = z.infer<typeof assistantReferenceSchema>;
export type AssistantStreamEvent = z.infer<typeof assistantStreamEventSchema>;

export function assistantSignIn({ owner, origin, network, nonce, expiresAt }: AssistantChallenge) {
  const chainId = automationChainFor(network);
  const networkName = getChain(chainId).name;
  return [
    'Rulebook requests wallet verification for Bookkeeper.',
    'This signature authorizes a temporary, read-only account assistant session.',
    'It cannot move funds or sign a transaction.',
    '',
    `Wallet: ${owner}`,
    `Origin: ${origin}`,
    `Network: ${networkName} (${network})`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt * 1000).toISOString()}`,
  ].join('\n');
}
