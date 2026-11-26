import {
  addressSchema,
  networkModeSchema,
  rulewrightJobIdSchema,
  rulewrightRequestSchema,
  txHashSchema,
} from '@rulebook/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { zeroAddress } from 'viem';
import { z } from 'zod';

import { sendError } from '../api/routes/errors.js';
import type { ServerDeps } from '../deps.js';

const base = '/v2/rulewright';
const challengeBody = z
  .object({ owner: addressSchema.refine((owner) => owner !== zeroAddress) })
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
    'rulewright_session_required',
    'Verify your wallet to use Rulewright.',
  );
}

function bearer(request: FastifyRequest) {
  return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
}

export function registerRulewrightRoutes(app: FastifyInstance, deps: ServerDeps) {
  const service = deps.rulewright;

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });
  app.get(`${base}/availability`, async (request) => {
    const query = z.object({ network: networkModeSchema.optional() }).safeParse(request.query);
    if (!query.success) return { available: false };
    return {
      available: (await service?.ready(query.data.network).catch(() => false)) ?? false,
    };
  });

  function context(request: FastifyRequest, reply: FastifyReply) {
    if (!service) {
      sendError(reply, 503, 'rulewright_unavailable', 'Rulewright is currently unavailable.');
      return null;
    }
    const origin = request.headers.origin ?? request.headers['x-rulewright-origin'];
    if (typeof origin !== 'string' || !deps.config.corsOrigins.includes(origin)) {
      sendError(reply, 403, 'rulewright_origin', 'This origin cannot use Rulewright.');
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
        return sendError(reply, 400, 'rulewright_wallet', 'Enter a valid wallet address.');
      return route.service.challenge(body.data.owner, route.origin);
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
        return sendError(reply, 400, 'rulewright_signature', 'The wallet signature is invalid.');
      return (
        (await route.service.signIn(body.data.nonce, route.origin, body.data.signature)) ??
        unauthorized(reply)
      );
    },
  );

  app.post(
    `${base}/jobs`,
    {
      bodyLimit: 64_000,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const route = context(request, reply);
      if (!route) return reply;
      const token = bearer(request);
      if (!token) return unauthorized(reply);
      const body = rulewrightRequestSchema.safeParse(request.body);
      if (!body.success)
        return sendError(
          reply,
          400,
          'rulewright_request',
          'Check the description and workflow details.',
        );
      const admission = await route.service.enqueue(token, route.origin, body.data);
      switch (admission.status) {
        case 'unauthorized':
          return unauthorized(reply);
        case 'limited':
          return sendError(
            reply,
            429,
            'rulewright_limit',
            'The daily Rulewright request limit has been reached. Try again tomorrow (UTC).',
          );
        case 'busy':
          return sendError(reply, 503, 'rulewright_busy', 'Rulewright is busy. Try again shortly.');
        case 'network_unavailable':
          return sendError(
            reply,
            503,
            'rulewright_network_unavailable',
            `Rulewright is not configured for ${admission.network}.`,
          );
        case 'queued':
          return reply.code(202).send({ id: admission.id });
      }
    },
  );

  app.get(
    `${base}/jobs/:id`,
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const route = context(request, reply);
      if (!route) return reply;
      const token = bearer(request);
      if (!token) return unauthorized(reply);
      const { id } = request.params as { id: string };
      if (!rulewrightJobIdSchema.safeParse(id).success)
        return sendError(reply, 400, 'rulewright_job_id', 'Invalid workflow request.');
      const job = await route.service.job(token, route.origin, id);
      if (job.status === 'unauthorized') return unauthorized(reply);
      if (job.status === 'missing')
        return sendError(
          reply,
          404,
          'rulewright_job_missing',
          'This workflow request has expired. Try again.',
        );
      return job;
    },
  );
}
