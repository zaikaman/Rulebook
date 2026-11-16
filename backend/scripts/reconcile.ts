#!/usr/bin/env node
/**
 * Compares each rule's on-chain `runs` counter with `count(executions)`. A mismatch is a bug in
 * the indexer, never something to patch by hand; the command exits non-zero.
 */
import { loadConfig } from '../src/config.js';
import { createServiceClient } from '../src/db/client.js';
import { createRepositories } from '../src/db/repositories/index.js';
import { SupabaseStore } from '../src/db/store.js';

export interface ReconcileMismatch {
  readonly agent: string;
  readonly ruleId: string;
  readonly runs: number;
  readonly executions: number;
}

/** Returns every (agent, rule) whose counters disagree. */
export async function reconcile(databaseUrl: string): Promise<ReconcileMismatch[]> {
  const config = loadConfig({ ...process.env, SUPABASE_URL: databaseUrl });
  const store = new SupabaseStore(createServiceClient(config));
  const repositories = createRepositories(store);
  const rules = await store.select('rules');
  const mismatches: ReconcileMismatch[] = [];
  for (const row of rules) {
    const agent = String(row.agent);
    const ruleId = String(row.rule_id);
    const runs = Number(row.runs ?? 0);
    const executions = await repositories.executions.countForRule(agent, ruleId);
    if (runs !== executions) mismatches.push({ agent, ruleId, runs, executions });
  }
  return mismatches;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    console.error('Set SUPABASE_URL (and the service-role key) before reconciling.');
    process.exit(1);
  }
  const mismatches = await reconcile(url);
  if (mismatches.length > 0) {
    console.error(`${mismatches.length} rule(s) disagree with their execution count:`);
    for (const mismatch of mismatches) console.error(JSON.stringify(mismatch));
    process.exit(1);
  }
  console.log('All rule counters match their executions.');
}

if (process.argv[1]?.endsWith('reconcile.ts')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
