import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { registerAccountRoutes } from './accounts.js';
import { registerChainRoutes } from './chains.js';
import { registerEncodeRoutes } from './encode.js';
import { registerExecutionRoutes } from './executions.js';
import { registerHealthRoutes } from './health.js';
import { registerMarketplaceRoutes } from './marketplace.js';
import { registerProofRoutes } from './proofs.js';
import { registerRuleRoutes } from './rules.js';
import { registerSponsorRoutes } from './sponsor.js';
import { registerTelegramRoutes } from './telegram.js';

/** Registers the complete route set declared in contracts/http-api.yaml. */
export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  registerHealthRoutes(app, deps);
  registerChainRoutes(app, deps);
  registerAccountRoutes(app, deps);
  registerRuleRoutes(app, deps);
  registerExecutionRoutes(app, deps);
  registerProofRoutes(app, deps);
  registerMarketplaceRoutes(app, deps);
  registerSponsorRoutes(app, deps);
  registerEncodeRoutes(app);
  void app.register(async (telegram) => {
    await telegram.register(rateLimit, { global: false });
    registerTelegramRoutes(telegram, deps);
  });
}
