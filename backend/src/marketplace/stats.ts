import type { ExecutionRow } from '../db/repositories/index.js';

/** Aggregated execution facts for one rule. All values come from real execution rows. */
export interface RuleStats {
  readonly runs: number;
  readonly successRate: number;
  readonly averageAmountIn: number | null;
}

const EMPTY_STATS: RuleStats = { runs: 0, successRate: 0, averageAmountIn: null };

function ruleKey(agent: string, ruleId: string): string {
  return `${agent.toLowerCase()}:${ruleId}`;
}

/**
 * Derives runs, success rate, and average amount from executions (FR-040). Nothing here reads
 * a self-reported field: a rule with no executions has zero runs, never an estimate.
 */
export function deriveRuleStats(
  executions: readonly ExecutionRow[],
): ReadonlyMap<string, RuleStats> {
  const totals = new Map<
    string,
    { total: number; confirmed: number; amounts: number[] }
  >();

  for (const execution of executions) {
    const key = ruleKey(execution.agent, execution.rule_id);
    const entry = totals.get(key) ?? { total: 0, confirmed: 0, amounts: [] };
    entry.total += 1;
    if (execution.status === 'confirmed') entry.confirmed += 1;
    if (execution.amount_in !== null) {
      const amount = Number(execution.amount_in);
      if (Number.isFinite(amount)) entry.amounts.push(amount);
    }
    totals.set(key, entry);
  }

  const stats = new Map<string, RuleStats>();
  for (const [key, entry] of totals) {
    stats.set(key, {
      runs: entry.total,
      successRate: entry.total === 0 ? 0 : entry.confirmed / entry.total,
      averageAmountIn:
        entry.amounts.length === 0
          ? null
          : entry.amounts.reduce((sum, amount) => sum + amount, 0) / entry.amounts.length,
    });
  }
  return stats;
}

/** The stats for one rule, with a zeroed fallback for rules that never executed. */
export function statsFor(
  stats: ReadonlyMap<string, RuleStats>,
  agent: string,
  ruleId: string,
): RuleStats {
  return stats.get(ruleKey(agent, ruleId)) ?? EMPTY_STATS;
}

export { ruleKey };
