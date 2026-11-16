import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { sendError } from './errors.js';

/** Registers `GET /v1/accounts/:agent`. */
export function registerAccountRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{ Params: { agent: string } }>('/v1/accounts/:agent', async (request, reply) => {
    const agent = await deps.repositories.agents.get(request.params.agent.toLowerCase());
    if (!agent) return sendError(reply, 404, 'not_found', 'Unknown agent');

    const vaults = await deps.repositories.vaults.listByOwner(agent.owner);
    const setupState = vaults.length > 0 ? 'complete' : 'agent_only';

    return {
      owner: agent.owner,
      agent: {
        address: agent.address,
        created_tx: agent.created_tx,
        active_rules: agent.rule_count,
      },
      vaults: vaults.map((vault) => ({
        address: vault.address,
        chain_id: vault.chain_id,
        connected: true,
        paused: vault.paused,
        mirror_mode: vault.mirror_mode,
        ...(vault.max_spend_per_run ? { max_spend_per_run: vault.max_spend_per_run } : {}),
      })),
      setup_state: setupState,
    };
  });
}
