import {
  addressSchema,
  telegramChallengeSchema,
  telegramDefaultSchema,
  telegramPreferenceSchema,
  uint256Schema,
} from '@rulebook/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ServerDeps } from '../../deps.js';
import { sameSecret, type TelegramService } from '../../telegram/service.js';
import { sendError } from './errors.js';

const base = '/v1/accounts/:agent/telegram';
const agentParams = z.object({ agent: addressSchema });
const ownerBody = z.object({ owner: addressSchema });
const confirmBody = z.object({ pairingId: z.string().regex(/^[a-f0-9]{64}$/) });
const sessionBody = ownerBody.extend({
  challenge: telegramChallengeSchema,
  signature: z
    .string()
    .max(8194)
    .regex(/^0x(?:[a-fA-F0-9]{2})+$/)
    .transform((value) => value as `0x${string}`),
});
const preferencesBody = z.union([
  z
    .object({ enabled: z.boolean().optional(), defaultMode: telegramDefaultSchema.optional() })
    .strict()
    .refine((body) => body.enabled !== undefined || body.defaultMode !== undefined),
  z
    .object({
      ruleId: z.string().max(78).pipe(uint256Schema).transform(String),
      preference: telegramPreferenceSchema,
    })
    .strict(),
]);
const privateMessage = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z.object({
    chat: z.object({ id: z.number().int().positive().safe(), type: z.literal('private') }),
    from: z.object({
      id: z.number().int().positive().safe(),
      is_bot: z.literal(false),
      username: z.string().optional(),
      first_name: z.string(),
    }),
    text: z.string(),
  }),
});

function unavailable(reply: FastifyReply) {
  return sendError(reply, 503, 'telegram_unavailable', 'Telegram notifications are unavailable.');
}

function context(
  request: FastifyRequest,
  reply: FastifyReply,
  service: TelegramService | undefined,
) {
  reply.header('cache-control', 'no-store');
  if (!service) {
    unavailable(reply);
    return null;
  }
  const params = agentParams.safeParse(request.params);
  if (!params.success) {
    sendError(reply, 400, 'invalid_agent', 'Invalid Rulebook account address.');
    return null;
  }
  return { service, agent: params.data.agent };
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  service: TelegramService | undefined,
) {
  const route = context(request, reply, service);
  if (!route) return null;
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
  const session = token ? await route.service.session(route.agent, token) : null;
  if (!session) {
    sendError(
      reply,
      401,
      'telegram_session_required',
      'Verify your wallet to manage Telegram notifications.',
    );
    return null;
  }
  return { ...route, session };
}

export function registerTelegramRoutes(app: FastifyInstance, deps: ServerDeps) {
  const service = deps.telegram;
  app.get('/v1/telegram/availability', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { available: (await service?.ready().catch(() => false)) ?? false };
  });
  app.post(`${base}/challenge`, { bodyLimit: 1024 }, async (request, reply) => {
    const route = context(request, reply, service);
    if (!route) return reply;
    const body = ownerBody.safeParse(request.body);
    if (!body.success)
      return sendError(reply, 400, 'invalid_owner', 'Invalid owner wallet address.');
    return route.service.challenge(route.agent, body.data.owner);
  });
  app.post(
    `${base}/session`,
    {
      bodyLimit: 12_000,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = context(request, reply, service);
      if (!route) return reply;
      const body = sessionBody.safeParse(request.body);
      if (!body.success)
        return sendError(reply, 400, 'invalid_signature', 'Invalid wallet verification request.');
      const { owner, challenge, signature } = body.data;
      try {
        const session = await route.service.signIn(route.agent, owner, challenge, signature);
        return (
          session ??
          sendError(
            reply,
            401,
            'wallet_not_verified',
            'Verify again with the wallet that owns this account.',
          )
        );
      } catch {
        request.log.warn('Telegram wallet verification service failed');
        return sendError(
          reply,
          503,
          'wallet_check_unavailable',
          'Wallet verification is temporarily unavailable. Try again shortly.',
        );
      }
    },
  );
  app.get(base, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    return route ? route.service.status(route.agent, route.session.hash) : reply;
  });
  app.post(`${base}/pairing`, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    const pairing = await route.service.pair(route.agent, route.session);
    return (
      pairing ??
      sendError(
        reply,
        409,
        'telegram_already_connected',
        'Disconnect the current Telegram chat before connecting another.',
      )
    );
  });
  app.post(`${base}/pairing/confirm`, { bodyLimit: 1024 }, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    const body = confirmBody.safeParse(request.body);
    if (
      !body.success ||
      !(await route.service.confirm(route.agent, route.session.hash, body.data.pairingId))
    ) {
      return sendError(
        reply,
        409,
        'telegram_pairing_incomplete',
        'Open the bot and tap Start using a fresh pairing link.',
      );
    }
    return route.service.status(route.agent, route.session.hash);
  });
  app.patch(`${base}/preferences`, { bodyLimit: 1024 }, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    const body = preferencesBody.safeParse(request.body);
    if (!body.success)
      return sendError(reply, 400, 'invalid_preferences', 'Invalid Telegram preference.');
    if (!(await route.service.preferences(route.agent, body.data))) {
      return sendError(
        reply,
        409,
        'telegram_preference_unavailable',
        'Connect Telegram first and select a current rule.',
      );
    }
    return route.service.status(route.agent, route.session.hash);
  });
  app.delete(`${base}/connection`, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    await route.service.disconnect(route.agent);
    return route.service.status(route.agent, route.session.hash);
  });
  app.post(`${base}/test`, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    if (!(await route.service.test(route.agent))) {
      return sendError(
        reply,
        409,
        'telegram_test_unavailable',
        'Connect Telegram and wait a minute between test messages.',
      );
    }
    return route.service.status(route.agent, route.session.hash);
  });
  app.post('/v1/telegram/webhook', { bodyLimit: 64_000 }, async (request, reply) => {
    if (!service) return unavailable(reply);
    if (
      !sameSecret(request.headers['x-telegram-bot-api-secret-token'], service.config.webhookSecret)
    ) {
      return sendError(reply, 403, 'telegram_webhook_forbidden', 'Invalid webhook credentials.');
    }
    const payload = privateMessage.safeParse(request.body);
    if (!payload.success) return { ok: true };
    const { update_id, message } = payload.data;
    if (message.chat.id !== message.from.id) return { ok: true };
    const startCode = /^\/start\s+([A-Za-z0-9_-]{43})$/.exec(message.text)?.[1];
    const stop = message.text === '/stop';
    if (!startCode && !stop) return { ok: true };
    const profile =
      (message.from.username ? `@${message.from.username}` : message.from.first_name.trim()).slice(
        0,
        100,
      ) || 'Telegram user';
    const handled = await service.webhook(update_id, message.chat.id, profile, startCode ?? null);
    if (!handled) return { ok: true };
    // Telegram executes a method returned in the webhook response. The settings page owns the
    // pairing state; losing this acknowledgement does not undo the database operation.
    return {
      method: 'sendMessage',
      chat_id: message.chat.id,
      text: stop
        ? 'Telegram alerts from Rulebook have been disconnected for this chat.'
        : 'Return to Rulebook and confirm this Telegram account to finish connecting.',
    };
  });
}
