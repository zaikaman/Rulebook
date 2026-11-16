import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AppConfig } from '../config.js';

/**
 * Creates the server-only Supabase client. The service-role key must never reach the frontend:
 * no `VITE_*` alias exists for it, and this module is not imported by the shared package.
 */
export function createServiceClient(config: AppConfig): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** True when a real `SELECT` against a table succeeds. */
export async function probeDatabase(client: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await client.from('indexer_cursors').select('chain_id').limit(1);
    return !error;
  } catch {
    return false;
  }
}
