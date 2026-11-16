import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { sendError } from './errors.js';

/**
 * Registers `POST /v1/starter-funds`. The capped, once-per-address transfer lands in Phase 3
 * (T094–T095); the route refuses until the relayer exists.
 */
export function registerStarterFundsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/v1/starter-funds', async (_request, reply) => {
    if (!deps.config.SPONSOR_PRIVATE_KEY) {
      return sendError(
        reply,
        503,
        'relayer_unavailable',
        'The sponsor relayer is not configured in this environment.',
      );
    }
    return sendError(reply, 503, 'relayer_unavailable', 'Starter funds ship with Phase 3.');
  });
}
