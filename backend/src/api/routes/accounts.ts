import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { sendError } from './errors.js';

/**
 * Registers `GET /v1/accounts/:agent`. `setup_state` is the resumable onboarding verdict:
 * no vault means `agent_only`; a vault the Agent has recorded is `complete`; a vault that
 * exists without that record is the `partial` state the client must finish (FR-004).
 */
export function registerAccountRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{ Params: { agent: string } }>('/v1/accounts/:agent', async (request, reply) => {
    const agent = await deps.repositories.agents.get(request.params.agent.toLowerCase());
    if (!agent) return sendError(reply, 404, 'not_found', 'Unknown agent');

    const vaults = await deps.repositories.vaults.listByOwner(agent.owner);
    const links = await Promise.all(
      vaults.map((vault) =>
        deps.accountChain.agentLink(agent.address as `0x${string}`, vault.chain_id),
      ),
    );
    const connected = vaults.map(
      (vault, index) => links[index]?.toLowerCase() === vault.address.toLowerCase(),
    );

    const setupState =
      vaults.length === 0 ? 'agent_only' : connected.some(Boolean) ? 'complete' : 'partial';

    return {
      owner: agent.owner,
      agent: {
        address: agent.address,
        created_tx: agent.created_tx,
        active_rules: agent.rule_count,
      },
      vaults: vaults.map((vault, index) => ({
        address: vault.address,
        chain_id: vault.chain_id,
        connected: connected[index] ?? false,
        paused: vault.paused,
        mirror_mode: vault.mirror_mode,
        ...(vault.max_spend_per_run ? { max_spend_per_run: vault.max_spend_per_run } : {}),
      })),
      setup_state: setupState,
    };
  });
}
