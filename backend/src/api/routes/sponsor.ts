import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';

/**
 * Registers `GET /v1/sponsor/:agent`. Phase 2 returns the neutral healthy state; Phase 4 reads
 * `reserves`/`debt` on both proxies and derives `low`/`exhausted`/`debt`.
 */
export function registerSponsorRoutes(app: FastifyInstance, _deps: ServerDeps): void {
  app.get<{ Params: { agent: string } }>('/v1/sponsor/:agent', async (request) => ({
    agent: request.params.agent.toLowerCase(),
    chains: [LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID].map((chainId) => ({
      chain_id: chainId,
      reserves: '0',
      debt: '0',
      state: 'healthy' as const,
    })),
  }));
}
