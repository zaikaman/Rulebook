import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { registerRulewrightRoutes } from '../../rulewright/routes.js';
import { registerHealthRoutes } from './health.js';
import { registerTelegramRoutes } from './telegram.js';

/** Registers the operational and assistant routes; workflow routes live in `workflows/`. */
export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  registerHealthRoutes(app, deps);
  void app.register(async (telegram) => {
    await telegram.register(rateLimit, { global: false });
    registerTelegramRoutes(telegram, deps);
  });
  void app.register(async (rulewright) => {
    await rulewright.register(rateLimit, { global: false });
    registerRulewrightRoutes(rulewright, deps);
  });
}
