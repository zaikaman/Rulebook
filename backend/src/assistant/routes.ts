import {
  addressSchema,
  assistantRequestSchema,
  assistantStreamEventSchema,
  networkModeSchema,
  txHashSchema,
  type AssistantStreamEvent,
} from '@rulebook/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { zeroAddress } from 'viem';
import { z } from 'zod';

import { sendError } from '../api/routes/errors.js';
import type { ServerDeps } from '../deps.js';
import type { AssistantToolTrace } from './provider.js';
import { BookkeeperAnswerError } from './service.js';

const base = '/v2/assistant';
const challengeBody = z
  .object({
    owner: addressSchema.refine((owner) => owner !== zeroAddress),
    network: networkModeSchema.default('testnet'),
  })
  .strict();
const sessionBody = z
  .object({
    nonce: txHashSchema,
    signature: z
      .string()
      .max(8194)
      .regex(/^0x(?:[a-fA-F0-9]{2})+$/)
      .transform((value) => value as `0x${string}`),
  })
  .strict();

function unauthorized(reply: FastifyReply) {
  return sendError(
    reply,
    401,
    'assistant_session_required',
    'Verify your wallet to use Bookkeeper.',
  );
}

function bearer(request: FastifyRequest) {
  return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
}

export function registerAssistantRoutes(app: FastifyInstance, deps: ServerDeps) {
  const service = deps.assistant;

  app.get(`${base}/availability`, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const query = z.object({ network: networkModeSchema.optional() }).safeParse(request.query);
    if (!query.success) return { available: false };
    const available = (await service?.ready(query.data.network).catch(() => false)) ?? false;
    const demoAvailable = Boolean(available && service?.hasDemoAccess(query.data.network));
    return {
      available,
      ...(demoAvailable ? { demoAvailable: true } : {}),
    };
  });

  function context(request: FastifyRequest, reply: FastifyReply) {
    reply.header('cache-control', 'no-store');
    if (!service) {
      sendError(reply, 503, 'assistant_unavailable', 'Bookkeeper is currently unavailable.');
      return null;
    }
    const origin = request.headers.origin ?? request.headers['x-assistant-origin'];
    if (typeof origin !== 'string' || !deps.config.corsOrigins.includes(origin)) {
      sendError(reply, 403, 'assistant_origin', 'This origin cannot use Bookkeeper.');
      return null;
    }
    return { service, origin };
  }

  app.post(
    `${base}/challenge`,
    {
      bodyLimit: 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = context(request, reply);
      if (!route) return reply;
      const body = challengeBody.safeParse(request.body);
      if (!body.success)
        return sendError(reply, 400, 'assistant_wallet', 'Enter a valid wallet address.');
      if (!route.service.hasDeployment(body.data.network)) {
        return sendError(
          reply,
          503,
          'assistant_network_unavailable',
          `Bookkeeper is not configured for ${body.data.network}.`,
        );
      }
      return route.service.challenge(body.data.owner, route.origin, body.data.network);
    },
  );

  app.post(
    `${base}/session`,
    {
      bodyLimit: 10_000,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = context(request, reply);
      if (!route) return reply;
      const body = sessionBody.safeParse(request.body);
      if (!body.success)
        return sendError(reply, 400, 'assistant_signature', 'The wallet signature is invalid.');
      return (
        (await route.service.signIn(body.data.nonce, route.origin, body.data.signature)) ??
        unauthorized(reply)
      );
    },
  );

  app.post(
    `${base}/demo-session`,
    {
      bodyLimit: 1024,
      config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const route = context(request, reply);
      if (!route) return reply;
      const body = z
        .object({ network: networkModeSchema.default('testnet') })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success)
        return sendError(reply, 400, 'assistant_network', 'Invalid network selection.');
      if (body.data.network !== 'testnet' || !route.service.hasDemoAccess(body.data.network)) {
        return sendError(
          reply,
          503,
          'assistant_demo_unavailable',
          'Bookkeeper demo mode is unavailable.',
        );
      }
      const session = await route.service.createDemoSession(route.origin, body.data.network);
      if (!session) {
        return sendError(
          reply,
          503,
          'assistant_demo_unavailable',
          'Bookkeeper demo mode is unavailable.',
        );
      }
      return session;
    },
  );

  app.delete(
    `${base}/session`,
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = context(request, reply);
      if (!route) return reply;
      const token = bearer(request);
      if (!token) return unauthorized(reply);
      const revoked = await route.service.revoke(token, route.origin);
      return revoked ? { revoked: true } : unauthorized(reply);
    },
  );

  app.post(
    `${base}/chat`,
    {
      bodyLimit: 32_000,
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = context(request, reply);
      if (!route) return reply;
      const token = bearer(request);
      if (!token) return unauthorized(reply);
      const body = assistantRequestSchema.safeParse(request.body);
      if (!body.success)
        return sendError(reply, 400, 'assistant_request', 'Check the question and try again.');

      const targetNetwork = body.data.network ?? 'testnet';
      if (!route.service.hasDeployment(targetNetwork)) {
        return sendError(
          reply,
          503,
          'assistant_network_unavailable',
          `Bookkeeper is not configured for ${targetNetwork}.`,
        );
      }

      const admission = await route.service.admit(
        token,
        route.origin,
        body.data.conversationId,
        body.data.message,
        targetNetwork,
      );
      if (admission.status === 'unauthorized') return unauthorized(reply);
      if (admission.status === 'limited')
        return sendError(
          reply,
          429,
          'assistant_limit',
          'The daily Bookkeeper limit has been reached. Try again tomorrow (UTC).',
        );
      if (admission.status === 'missing')
        return sendError(
          reply,
          404,
          'assistant_conversation_missing',
          'This conversation expired. Start a new chat.',
        );

      const raw = reply.raw;
      const controller = new AbortController();
      reply.hijack();
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'access-control-allow-origin': route.origin,
        vary: 'origin',
      });
      raw.on('close', () => {
        if (!raw.writableEnded) controller.abort();
      });

      const send = (event: AssistantStreamEvent) => {
        if (raw.writableEnded || raw.destroyed) return;
        const parsed = assistantStreamEventSchema.safeParse(event);
        if (!parsed.success) return;
        raw.write(`data: ${JSON.stringify(parsed.data)}\n\n`);
      };
      const trace: AssistantToolTrace[] = [];
      let text = '';
      send({ type: 'status', label: 'Reading your question' });

      try {
        const result = await route.service.answer(
          {
            owner: admission.owner,
            history: admission.history,
            message: body.data.message,
            page: body.data.page,
            network: targetNetwork,
            demo: admission.demo,
          },
          {
            signal: controller.signal,
            onStatus: (label) => send({ type: 'status', label }),
            onTool: (event) => {
              trace.push(event);
              send({
                type: 'tool',
                name: event.name,
                label: event.label,
                state: event.state,
                ...(event.detail ? { detail: event.detail } : {}),
              });
            },
            onDelta: (delta) => {
              text += delta;
              send({ type: 'delta', text: delta });
            },
          },
        );
        text = result.text;
        await route.service
          .finish(admission.conversation, admission.owner, result.text, result.tools)
          .catch((finishError: unknown) => {
            request.log.warn({ err: finishError }, 'Bookkeeper answer was not saved');
          });
        send({
          type: 'done',
          conversationId: admission.conversation,
          references: [...result.references],
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          send({
            type: 'error',
            message:
              error instanceof BookkeeperAnswerError
                ? error.message
                : 'Bookkeeper could not answer that. Try again shortly.',
          });
        }
        if (text.trim()) {
          await route.service
            .finish(admission.conversation, admission.owner, text, trace)
            .catch(() => undefined);
        } else if (admission.message_id !== undefined) {
          await route.service
            .rollback(admission.conversation, admission.owner, admission.message_id)
            .catch(() => undefined);
        }
      } finally {
        if (!raw.writableEnded && !raw.destroyed) raw.end();
      }
    },
  );
}
