import { z } from 'zod';

import { networkModeForChain } from './chains.js';
import { addressSchema, networkModeSchema, txHashSchema } from './schemas.js';
import { v2DraftSchema } from './workflowV2Draft.js';
import { workflowLimits } from './workflows.js';

export const rulewrightPromptLimit = 2000;
export const rulewrightFollowUpLimit = 4;

export const rulewrightChallengeSchema = z.object({
  nonce: txHashSchema,
  owner: addressSchema,
  origin: z.string().url(),
  expiresAt: z.number().int().positive(),
});

export const rulewrightSessionSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.number().int().positive(),
});

export const rulewrightJobIdSchema = z.string().uuid();

const prompt = z.string().trim().min(1).max(rulewrightPromptLimit);
const message = z.string().trim().min(1).max(500);

function boundedDraft(value: unknown) {
  if (!value || typeof value !== 'object' || !('root' in value)) return false;
  const pending = [{ node: value.root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > workflowLimits.nodes || depth > workflowLimits.conditionDepth) return false;
    if (node && typeof node === 'object' && ('yes' in node || 'no' in node)) {
      if (!('yes' in node) || !('no' in node) || depth >= workflowLimits.conditionDepth)
        return false;
      pending.push({ node: node.yes, depth: depth + 1 }, { node: node.no, depth: depth + 1 });
    }
  }
  return true;
}

const draftSchema = z.custom<unknown>(boundedDraft).pipe(v2DraftSchema);

export const rulewrightRequestSchema = z
  .object({
    prompt,
    draft: draftSchema.optional(),
    network: networkModeSchema.optional(),
    followUps: z
      .array(z.object({ question: message, answer: prompt }).strict())
      .max(rulewrightFollowUpLimit),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.network && value.draft && networkModeForChain(value.draft.chain) !== value.network) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Draft network does not match the selected network mode.',
        path: ['network'],
      });
    }
  });

export const rulewrightResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('draft'), draft: draftSchema }),
  z.object({ type: z.literal('question'), message }),
  z.object({ type: z.literal('unsupported'), message }),
  z.object({ type: z.literal('error'), message }),
]);

export const rulewrightJobSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('complete'), result: rulewrightResultSchema }),
]);

export type RulewrightChallenge = z.infer<typeof rulewrightChallengeSchema>;
export type RulewrightRequest = z.infer<typeof rulewrightRequestSchema>;
export type RulewrightResult = z.infer<typeof rulewrightResultSchema>;

export function rulewrightSignIn({ owner, origin, nonce, expiresAt }: RulewrightChallenge) {
  return [
    'Rulebook requests wallet verification for Rulewright.',
    'This signature authorizes a temporary workflow drafting session.',
    '',
    `Wallet: ${owner}`,
    `Origin: ${origin}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt * 1000).toISOString()}`,
  ].join('\n');
}
