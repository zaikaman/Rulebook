import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { registerAssistantRoutes } from '../../assistant/routes.js';
import { registerRulewrightRoutes } from '../../rulewright/routes.js';
import { registerHealthRoutes } from './health.js';
import { registerTelegramRoutes } from './telegram.js';

/** Registers the operational and assistant routes; workflow routes live in `workflows/`. */
export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  void app.register(async (health) => {
    await health.register(rateLimit, { global: false });
    registerHealthRoutes(health, deps);
  });
  void app.register(async (telegram) => {
    await telegram.register(rateLimit, { global: false });
    registerTelegramRoutes(telegram, deps);
  });
  void app.register(async (rulewright) => {
    await rulewright.register(rateLimit, { global: false });
    registerRulewrightRoutes(rulewright, deps);
  });
  void app.register(async (assistant) => {
    await assistant.register(rateLimit, { global: false });
    registerAssistantRoutes(assistant, deps);
  });
}
