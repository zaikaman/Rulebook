#!/usr/bin/env node
/**
 * Publishes the team-authored rules from `packages/shared/manifest/seed-rules.json` into the
 * read model. This is a database seed, never a chain write: FR-052 keeps the registry writable
 * only by a rule owner's own transaction. Running it repeatedly is safe and leaves the catalog
 * non-empty on first load (SC-013), with every row badged `team` (FR-041).
 */
import { loadConfig } from '../src/config.js';
import { createServiceClient } from '../src/db/client.js';
import { createRepositories } from '../src/db/repositories/index.js';
import { SupabaseStore } from '../src/db/store.js';
import { seedMarketplace } from '../src/marketplace/seed.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new SupabaseStore(createServiceClient(config));
  const repositories = createRepositories(store);
  await seedMarketplace(repositories);
  console.log('Marketplace seed complete: team-authored rules are published.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
