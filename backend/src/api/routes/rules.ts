import type { RuleRow } from '../../db/repositories/index.js';
import type { ServerDeps } from '../../deps.js';
import type { FastifyInstance } from 'fastify';

import { sendError } from './errors.js';

function toApiRule(row: RuleRow) {
  return {
    agent: row.agent,
    rule_id: row.rule_id,
    template: row.template,
    chain_id: row.chain_id,
    status: row.status,
    latched: row.latched,
    runs: row.runs,
    is_public: row.is_public,
    ...(row.pair ? { pair: row.pair } : {}),
    ...(row.token_in ? { token_in: row.token_in } : {}),
    ...(row.token_out ? { token_out: row.token_out } : {}),
    ...(row.amount_in ? { amount_in: row.amount_in } : {}),
    ...(row.threshold ? { threshold: row.threshold } : {}),
    ...(row.secondary ? { secondary: row.secondary } : {}),
    ...(row.last_run_at ? { last_run_at: row.last_run_at } : {}),
  };
}

/** Registers the account rule list and detail routes. */
export function registerRuleRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{
    Params: { agent: string };
    Querystring: { status?: 'active' | 'paused' | 'cancelled' | 'all' };
  }>('/v1/accounts/:agent/rules', async (request) => {
    const status = request.query.status ?? 'active';
    const rows = await deps.repositories.rules.list(request.params.agent.toLowerCase(), status);
    return { rules: rows.map(toApiRule) };
  });

  app.get<{ Params: { agent: string; ruleId: string } }>(
    '/v1/accounts/:agent/rules/:ruleId',
    async (request, reply) => {
      const agent = request.params.agent.toLowerCase();
      const rule = await deps.repositories.rules.get(agent, request.params.ruleId);
      if (!rule) return sendError(reply, 404, 'not_found', 'Unknown rule');
      const executions = await deps.repositories.executions.list(
        { agent, rule_id: rule.rule_id },
        10,
      );
      return {
        rule: toApiRule(rule),
        recent_executions: executions.map((execution) => ({
          chain_id: execution.chain_id,
          tx_hash: execution.tx_hash,
          vault: execution.vault,
          agent: execution.agent,
          rule_id: execution.rule_id,
          kind: execution.kind,
          block_time: execution.block_time,
          status: execution.status,
          ...(execution.token_in ? { token_in: execution.token_in } : {}),
          ...(execution.token_out ? { token_out: execution.token_out } : {}),
          ...(execution.amount_in ? { amount_in: execution.amount_in } : {}),
          ...(execution.amount_out ? { amount_out: execution.amount_out } : {}),
          ...(execution.leader_tx ? { leader_tx: execution.leader_tx } : {}),
        })),
      };
    },
  );
}
