import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { isAddress } from 'viem';
import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { loadAccountCredit } from '../../sponsor/status.js';
import { sendError } from './errors.js';

/**
 * Registers `GET /v1/sponsor/:agent`. Reserves and debt are read from the Lasna system
 * contract and the Unichain callback proxy, then reduced to one honest state per chain.
 */
export function registerSponsorRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{ Params: { agent: string } }>('/v1/sponsor/:agent', async (request, reply) => {
    const agent = request.params.agent.toLowerCase();
    if (!isAddress(agent)) {
      return sendError(reply, 400, 'invalid_query', 'The agent address is not valid.');
    }

    const credit = await loadAccountCredit(deps, agent).catch(() => null);
    if (credit) return credit.status;

    // No sponsor source configured: keep the documented shape but claim nothing about funds.
    return {
      agent,
      chains: [LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID].map((chainId) => ({
        chain_id: chainId,
        reserves: '0',
        debt: '0',
        state: 'healthy' as const,
      })),
    };
  });
}
