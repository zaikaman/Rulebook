import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { sendError } from './errors.js';

/**
 * Registers `POST /v1/onboarding`. The sponsor relayer lands in Phase 3 (T091–T093); without a
 * configured key the route refuses rather than pretending to deploy.
 */
export function registerOnboardingRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/v1/onboarding', async (_request, reply) => {
    if (!deps.config.SPONSOR_PRIVATE_KEY) {
      return sendError(
        reply,
        503,
        'relayer_unavailable',
        'The sponsor relayer is not configured in this environment.',
      );
    }
    return sendError(reply, 503, 'relayer_unavailable', 'Onboarding ships with Phase 3.');
  });
}
