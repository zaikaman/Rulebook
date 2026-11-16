import { DraftError, encodeAddRule, missingSlots, readableSentence } from '@rulebook/shared';
import type { Address } from '@rulebook/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sendError } from './errors.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const bodySchema = z.object({
  template: z.number().int().min(1).max(13),
  chain_id: z.number().int(),
  slots: z.record(z.string(), z.union([z.string(), z.boolean()])),
  agent: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

/**
 * Registers `POST /v1/encode/preview`. Stateless: produces calldata only, never signs, stores,
 * or touches a chain.
 */
export function registerEncodeRoutes(app: FastifyInstance): void {
  app.post('/v1/encode/preview', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 422, 'invalid_query', parsed.error.message);
    }
    const slots = Object.fromEntries(
      Object.entries(parsed.data.slots).map(([key, value]) => [key, String(value)]),
    );
    const draft = {
      template: parsed.data.template,
      chainId: parsed.data.chain_id,
      slots,
    };
    const agent = (parsed.data.agent ?? ZERO_ADDRESS) as Address;

    try {
      const missing = missingSlots(draft);
      if (missing.length > 0) {
        return sendError(
          reply,
          422,
          'incomplete_draft',
          `Missing slot(s): ${missing.join(', ')}`,
          missing.join(','),
        );
      }
      return {
        to: agent,
        data: encodeAddRule(agent, draft),
        readable_sentence: readableSentence(draft),
        missing_slots: missing,
      };
    } catch (error) {
      if (error instanceof DraftError) {
        return sendError(reply, 422, error.code, error.message, error.slots.join(','));
      }
      throw error;
    }
  });
}
