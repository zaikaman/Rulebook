#!/usr/bin/env node
/**
 * Daily keep-alive for the Supabase free plan. Runs a real `SELECT` against a table; an RPC
 * that returned a constant would not count as activity.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadConfig } from '../config.js';
import { createServiceClient, probeDatabase } from '../db/client.js';

/** Performs one real query and returns whether it succeeded. */
export async function keepAlive(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.from('indexer_cursors').select('chain_id').limit(1);
  return !error;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = createServiceClient(config);
  const reachable = await probeDatabase(client);
  if (!reachable) {
    console.error('Database probe failed.');
    process.exit(1);
  }
  const alive = await keepAlive(client);
  if (!alive) {
    console.error('Keep-alive SELECT failed.');
    process.exit(1);
  }
  console.log('Keep-alive SELECT succeeded.');
}

if (process.argv[1]?.endsWith('keepalive.ts')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
