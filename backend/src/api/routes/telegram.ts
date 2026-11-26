import {
  addressSchema,
  automationChainFor,
  networkModeSchema,
  telegramChallengeSchema,
  telegramDefaultSchema,
  telegramPreferenceSchema,
  uint256Schema,
  workflowIdSchema,
  type Address,
  type NetworkMode,
} from '@rulebook/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ServerDeps } from '../../deps.js';
import { sameSecret, type TelegramService } from '../../telegram/service.js';
import { handleTelegramUpdate } from '../../telegram/updates.js';
import { sendError } from './errors.js';

const base = '/v1/accounts/:agent/telegram';
// Refresh the browser's cookie on use. Browsers cap the lifetime of any one cookie.
const BROWSER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
const agentParams = z.object({ agent: addressSchema });
const ownerBody = z.object({ owner: addressSchema });
const challengeBody = ownerBody.extend({ browser: z.literal(true).optional() });
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
  z.object({ workflowId: workflowIdSchema, preference: telegramPreferenceSchema }).strict(),
  z
    .object({ fundingAlerts: z.boolean().optional(), actionAlerts: z.boolean().optional() })
    .strict()
    .refine((body) => body.fundingAlerts !== undefined || body.actionAlerts !== undefined),
]);
function unavailable(reply: FastifyReply) {
  return sendError(reply, 503, 'telegram_unavailable', 'Telegram notifications are unavailable.');
}

function cookieName(origin: string, network: NetworkMode) {
  const baseName = origin.startsWith('https:') ? '__Secure-rulebook-telegram' : 'rulebook-telegram';
  return network === 'mainnet' ? `${baseName}-mainnet` : baseName;
}

function browserToken(request: FastifyRequest, origin: string, network: NetworkMode) {
  const prefix = `${cookieName(origin, network)}=`;
  const entries = request.headers.cookie?.split(';').map((entry) => entry.trim()) ?? [];
  const matches = entries.filter((entry) => entry.startsWith(prefix));
  const token = matches.length === 1 ? matches[0]?.slice(prefix.length) : undefined;
  return /^[A-Za-z0-9_-]{43}$/.exec(token ?? '')?.[0];
}

function setBrowserCookie(
  reply: FastifyReply,
  agent: Address,
  origin: string,
  token: string,
  network: NetworkMode,
) {
  const secure = origin.startsWith('https:') ? '; Secure' : '';
  const maxAge = token ? BROWSER_COOKIE_MAX_AGE : 0;
  reply.header(
    'set-cookie',
    `${cookieName(origin, network)}=${token}; Path=/v1/accounts/${agent}/telegram; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`,
  );
}

function requireAppOrigin(request: FastifyRequest, reply: FastifyReply, origin: string) {
  if (request.headers.origin === origin) return true;
  sendError(
    reply,
    403,
    'telegram_origin_forbidden',
    'Open Rulebook to manage Telegram notifications.',
  );
  return false;
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
  const networkParsed = z
    .object({ network: networkModeSchema.default('testnet') })
    .safeParse(request.query);
  if (!networkParsed.success) {
    sendError(reply, 400, 'invalid_network', 'Invalid network parameter.');
    return null;
  }
  const network = networkParsed.data.network;
  return {
    service,
    agent: params.data.agent,
    network,
    automationChain: automationChainFor(network),
  };
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  service: TelegramService | undefined,
) {
  const route = context(request, reply, service);
  if (!route) return null;
  const origin = route.service.config.appOrigin;
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
  const cookie = bearer ? undefined : browserToken(request, origin, route.network);
  if (
    cookie &&
    (request.method !== 'GET' || request.headers.origin !== undefined) &&
    !requireAppOrigin(request, reply, origin)
  )
    return null;
  const token = bearer ?? cookie;
  const session = token
    ? await route.service.session(route.agent, token, Boolean(cookie), route.automationChain)
    : null;
  if (!session) {
    sendError(
      reply,
      401,
      'telegram_session_required',
      'Verify your wallet to manage Telegram notifications.',
    );
    return null;
  }
  return { ...route, session, cookie };
}

export function registerTelegramRoutes(app: FastifyInstance, deps: ServerDeps) {
  const service = deps.telegram;
  app.get('/v1/telegram/availability', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const parsedQuery = z
      .object({
        workflow: z.literal('true').optional(),
        network: networkModeSchema.optional(),
      })
      .safeParse(request.query);
    if (!parsedQuery.success) {
      return sendError(reply, 400, 'invalid_network', 'Invalid network parameter.');
    }
    const workflow = parsedQuery.data.workflow === 'true';
    const automationChain = parsedQuery.data.network
      ? automationChainFor(parsedQuery.data.network)
      : undefined;
    return {
      available: (await service?.ready(workflow, automationChain).catch(() => false)) ?? false,
    };
  });
  app.post(`${base}/challenge`, { bodyLimit: 1024 }, async (request, reply) => {
    const route = context(request, reply, service);
    if (!route) return reply;
    const body = challengeBody.safeParse(request.body);
    if (!body.success)
      return sendError(reply, 400, 'invalid_owner', 'Invalid owner wallet address.');
    const { owner, browser } = body.data;
    if (browser && !requireAppOrigin(request, reply, route.service.config.appOrigin)) return reply;
    return route.service.challenge(route.agent, owner, browser, route.automationChain);
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
      const browser = challenge.browser;
      const origin = route.service.config.appOrigin;
      if (browser && !requireAppOrigin(request, reply, origin)) return reply;
      try {
        const session = await route.service.signIn(
          route.agent,
          owner,
          challenge,
          signature,
          route.automationChain,
        );
        if (!session)
          return sendError(
            reply,
            401,
            'wallet_not_verified',
            'Verify again with the wallet that owns this account.',
          );
        if (!browser) return session;
        setBrowserCookie(reply, route.agent, origin, session.token, route.network);
        return { verified: true };
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
  app.delete(`${base}/session`, async (request, reply) => {
    const route = context(request, reply, service);
    if (!route) return reply;
    const origin = route.service.config.appOrigin;
    if (!requireAppOrigin(request, reply, origin)) return reply;
    const token = browserToken(request, origin, route.network);
    if (token) await route.service.forgetBrowser(route.agent, token, route.automationChain);
    setBrowserCookie(reply, route.agent, origin, '', route.network);
    return { forgotten: true };
  });
  app.get(base, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    const settings = await route.service.status(
      route.agent,
      route.session.hash,
      route.automationChain,
    );
    if (route.cookie)
      setBrowserCookie(
        reply,
        route.agent,
        route.service.config.appOrigin,
        route.cookie,
        route.network,
      );
    return settings;
  });
  app.post(`${base}/pairing`, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    const pairing = await route.service.pair(route.agent, route.session, route.automationChain);
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
      !(await route.service.confirm(
        route.agent,
        route.session.hash,
        body.data.pairingId,
        route.automationChain,
      ))
    ) {
      return sendError(
        reply,
        409,
        'telegram_pairing_incomplete',
        'Open the bot and tap Start using a fresh pairing link.',
      );
    }
    return route.service.status(route.agent, route.session.hash, route.automationChain);
  });
  app.patch(`${base}/preferences`, { bodyLimit: 1024 }, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    const body = preferencesBody.safeParse(request.body);
    if (!body.success)
      return sendError(reply, 400, 'invalid_preferences', 'Invalid Telegram preference.');
    if (!(await route.service.preferences(route.agent, body.data, route.automationChain))) {
      return sendError(
        reply,
        409,
        'telegram_preference_unavailable',
        'Connect Telegram first and select a current rule or workflow.',
      );
    }
    return route.service.status(route.agent, route.session.hash, route.automationChain);
  });
  app.delete(`${base}/connection`, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    await route.service.disconnect(route.agent, route.automationChain);
    return route.service.status(route.agent, route.session.hash, route.automationChain);
  });
  app.post(`${base}/test`, async (request, reply) => {
    const route = await authenticate(request, reply, service);
    if (!route) return reply;
    if (!(await route.service.test(route.agent, route.automationChain))) {
      return sendError(
        reply,
        409,
        'telegram_test_unavailable',
        'Connect Telegram and wait a minute between test messages.',
      );
    }
    return route.service.status(route.agent, route.session.hash, route.automationChain);
  });
  app.post('/v1/telegram/webhook', { bodyLimit: 64_000 }, async (request, reply) => {
    if (!service) return unavailable(reply);
    if (
      !sameSecret(request.headers['x-telegram-bot-api-secret-token'], service.config.webhookSecret)
    ) {
      return sendError(reply, 403, 'telegram_webhook_forbidden', 'Invalid webhook credentials.');
    }
    const response = await handleTelegramUpdate(service, request.body);
    if (!response) return { ok: true };
    // Telegram executes a method returned in the webhook response. The settings page owns the
    // pairing state; losing this acknowledgement does not undo the database operation.
    return {
      method: 'sendMessage',
      chat_id: response.chatId,
      text: response.text,
    };
  });
}
