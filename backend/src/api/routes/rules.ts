import type { RuleEventRow, RuleRow } from '../../db/repositories/index.js';
import type { ServerDeps } from '../../deps.js';
import { loadAccountCredit } from '../../sponsor/status.js';
import type { FastifyInstance } from 'fastify';
import { addressSchema } from '@rulebook/shared';

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

function toApiAlert(row: RuleEventRow) {
  return {
    rule_id: row.rule_id,
    tx_hash: row.tx_hash,
    block_time: row.block_time,
  };
}

/** Registers the account rule list and detail routes. */
export function registerRuleRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{
    Params: { agent: string };
    Querystring: { status?: 'active' | 'paused' | 'cancelled' | 'all' };
  }>('/v1/accounts/:agent/rules', async (request) => {
    const status = request.query.status ?? 'active';
    const agent = request.params.agent.toLowerCase();
    const [rows, alerts] = await Promise.all([
      deps.repositories.rules.list(agent, status),
      deps.repositories.ruleEvents.listAlerts(agent).catch(() => []),
    ]);
    return { rules: rows.map(toApiRule), alerts: alerts.map(toApiAlert) };
  });

  app.get<{ Params: { agent: string; ruleId: string } }>(
    '/v1/accounts/:agent/rules/:ruleId',
    async (request, reply) => {
      const agent = request.params.agent.toLowerCase();
      const rule = await deps.repositories.rules.get(agent, request.params.ruleId);
      if (!rule) return sendError(reply, 404, 'not_found', 'Unknown rule');
      const [executions, credit, mirror] = await Promise.all([
        deps.repositories.executions.list({ agent, rule_id: rule.rule_id }, 10),
        loadAccountCredit(deps, agent).catch(() => null),
        deps.repositories.mirrors.get(agent, rule.rule_id),
      ]);
      const parsedAgent = addressSchema.safeParse(agent);
      const linkedVault =
        !mirror &&
        parsedAgent.success &&
        rule.is_public &&
        rule.status === 'active' &&
        rule.template >= 1 &&
        rule.template <= 6 &&
        rule.token_in &&
        rule.token_out
          ? await deps.accountChain.agentLink(parsedAgent.data, rule.chain_id)
          : null;
      const source = linkedVault
        ? await deps.repositories.vaults.get(linkedVault.toLowerCase())
        : null;
      const alerts = await deps.repositories.ruleEvents
        .listAlerts(agent, rule.rule_id, 5)
        .catch(() => []);
      const recentExecutions = await Promise.all(
        executions.map(async (execution) => {
          const callback = await deps.repositories.callbacks.findByDestinationTx(execution.tx_hash);
          const mirrorRequests =
            !callback && execution.leader_tx
              ? await deps.repositories.ruleEvents.listMirrorRequests(execution.leader_tx)
              : [];
          const reactiveTx =
            callback?.reactive_tx_hash ??
            mirrorRequests.find(
              (request) => request.agent === agent && request.rule_id === rule.rule_id,
            )?.tx_hash;
          return {
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
            ...(reactiveTx ? { reactive_tx_hash: reactiveTx } : {}),
          };
        }),
      );

      return {
        rule: toApiRule(rule),
        recent_executions: recentExecutions,
        alerts: alerts.map(toApiAlert),
        ...(mirror?.leader_vault && mirror.per_run_cap
          ? {
              mirror: {
                leader_agent: mirror.leader_agent,
                leader_rule_id: mirror.leader_rule_id,
                leader_vault: mirror.leader_vault,
                scale_bps: mirror.scale_bps,
                per_run_cap: mirror.per_run_cap,
                hourly_cap: mirror.hourly_cap,
                detached_at: mirror.detached_at,
              },
            }
          : {}),
        ...(source && !source.mirror_mode && source.agent === agent
          ? { mirror_source: source.address }
          : {}),
        // T158: the detail view gets its budget and sponsor state in the same response.
        ...(credit ? { budget: credit.budget, sponsor: credit.status } : {}),
      };
    },
  );
}
