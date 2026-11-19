import { z } from 'zod';

import { LASNA_CHAIN_ID } from './chains.js';
import { getTemplate } from './generated/templates.js';
import { templateIdSchema, txHashSchema } from './schemas.js';

export const telegramDefaultSchema = z.enum(['all', 'selected']);
export const telegramPreferenceSchema = z.enum(['inherit', 'send', 'mute']);
export const alertTemplateSchema = z.union([z.literal(11), z.literal(12), z.literal(13)]);
export const telegramAvailabilitySchema = z.object({ available: z.boolean() });
export const telegramChallengeSchema = z.object({
  nonce: txHashSchema,
  expiresAt: z.number().int().positive(),
  origin: z.string().url(),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
});
export const telegramSessionSchema = z.object({ token: z.string(), expiresAt: z.number().int() });
export const telegramPairingSchema = z.object({
  url: z.string().url(),
  expiresAt: z.number().int(),
});
export const telegramSettingsSchema = z.object({
  connection: z.enum(['disconnected', 'connected', 'blocked']),
  profile: z.string().nullable(),
  configured: z.boolean(),
  enabled: z.boolean(),
  defaultMode: telegramDefaultSchema,
  pendingPairing: z.object({ id: z.string(), profile: z.string() }).nullable(),
  testDelivery: z.enum(['pending', 'sent', 'failed']).nullable(),
  rules: z.array(
    z.object({
      id: z.string(),
      template: templateIdSchema,
      preference: telegramPreferenceSchema,
    }),
  ),
});

export type TelegramChallenge = z.infer<typeof telegramChallengeSchema>;
export type TelegramPreference = z.infer<typeof telegramPreferenceSchema>;
export type TelegramDefault = z.infer<typeof telegramDefaultSchema>;
export type TelegramSettings = z.infer<typeof telegramSettingsSchema>;

export function telegramRuleName(template: number | null): string {
  return (
    (template === null
      ? undefined
      : getTemplate(template)?.name.replace(/([a-z])([A-Z])/g, '$1 $2')) ?? 'Rule'
  );
}

export function telegramSignIn(
  agent: `0x${string}`,
  { origin, nonce, expiresAt }: TelegramChallenge,
) {
  return {
    domain: {
      name: 'Rulebook Telegram notifications',
      version: '1',
      chainId: LASNA_CHAIN_ID,
      verifyingContract: agent,
    },
    types: {
      TelegramSignIn: [
        { name: 'origin', type: 'string' },
        { name: 'purpose', type: 'string' },
        { name: 'nonce', type: 'bytes32' },
        { name: 'expiresAt', type: 'uint256' },
      ],
    },
    primaryType: 'TelegramSignIn',
    message: {
      origin,
      purpose: 'Manage Telegram notifications',
      nonce,
      expiresAt: BigInt(expiresAt),
    },
  } as const;
}
