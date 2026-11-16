import { CHAIN_CONFIGS, TEMPLATES } from '@rulebook/shared';
import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';

/** Registers `GET /v1/chains`. */
export function registerChainRoutes(app: FastifyInstance, _deps: ServerDeps): void {
  app.get('/v1/chains', async () => ({
    chains: [...CHAIN_CONFIGS.values()].map((chain) => ({
      chain_id: chain.chainId,
      name: chain.name,
      role: chain.role,
      explorer: chain.explorerUrl,
      is_origin: chain.isOrigin,
      is_destination: chain.isDestination,
      supported_templates: [...chain.supportedTemplates],
    })),
    templates: TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
      sentence: template.sentence,
      slots: template.slots.map((slot) => ({
        key: slot.key,
        kind: slot.kind,
        label: slot.label,
        required: slot.required,
        min: slot.min,
        max: slot.max,
      })),
    })),
  }));
}
