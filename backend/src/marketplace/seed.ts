import seedManifest from '@rulebook/shared/manifest/seed-rules.json' with { type: 'json' };
import {
  ruleParamsFromDraft,
  ruleParamsHash,
  type RuleDraft,
} from '@rulebook/shared';

import type { Repositories } from '../db/repositories/index.js';

/**
 * The chain the seeded rule would execute on. A listing lives on Lasna, but the rule's money
 * parameters belong to the funds chain, exactly as `Agent.addRule` stores them.
 */
export const SEED_FUNDS_CHAIN_ID = 1301;
/** Lasna, where `RuleRegistry` is deployed. */
export const SEED_LISTING_CHAIN_ID = 5_318_007;
/** Team author address, deliberately not a real user address. */
export const SEED_AUTHOR = '0x7ea0000000000000000000000000000000000001';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_HASH = `0x${'0'.repeat(64)}`;

interface SeedRule {
  readonly name: string;
  readonly description: string;
  readonly template: number;
  readonly authorBadge: 'team' | 'community';
  readonly slots: Readonly<Record<string, string>>;
}

/** Deterministic pseudo-agent for a seed rule; never a real deployed Agent. */
export function seedAgentAddress(index: number): string {
  return `0x5eed${index.toString(16).padStart(4, '0')}${'0'.repeat(32)}`;
}

/**
 * Publishes the team-authored seed rules from the shared manifest into the read model.
 *
 * This is a database seed, not a chain write: the registry is only ever written by a rule
 * owner's own transaction (FR-052). Every row is idempotent, so the script can run on every
 * deployment and the marketplace is never empty on first load (SC-013, FR-041).
 */
export async function seedMarketplace(
  repositories: Repositories,
  options: {
    readonly fundsChainId?: number;
    readonly listingChainId?: number;
  } = {},
): Promise<void> {
  const fundsChainId = options.fundsChainId ?? SEED_FUNDS_CHAIN_ID;
  const listingChainId = options.listingChainId ?? SEED_LISTING_CHAIN_ID;
  const rules = seedManifest.rules as unknown as readonly SeedRule[];

  for (const [index, seed] of rules.entries()) {
    const agent = seedAgentAddress(index);
    const ruleId = String(index + 1);
    const draft: RuleDraft = {
      template: seed.template,
      chainId: fundsChainId,
      slots: seed.slots,
    };
    const params = ruleParamsFromDraft(draft);
    const createdAt = new Date(Date.UTC(2026, 10, 1, index)).toISOString();

    await repositories.agents.upsert({
      address: agent,
      owner: SEED_AUTHOR,
      factory: ZERO_ADDRESS,
      created_tx: ZERO_HASH,
      created_block: 0,
      rule_count: 1,
      chain_id: listingChainId,
    });
    await repositories.rules.upsert({
      agent,
      rule_id: ruleId,
      template: params.template,
      chain_id: params.chainId,
      status: 'active',
      latched: false,
      pair: params.pair,
      token_in: params.tokenIn,
      token_out: params.tokenOut,
      amount_in: params.amountIn.toString(),
      threshold: params.threshold.toString(),
      secondary: params.secondary.toString(),
      last_run_at: null,
      runs: 0,
      is_public: true,
    });
    await repositories.listings.upsert({
      chain_id: listingChainId,
      listing_id: ruleId,
      agent,
      rule_id: ruleId,
      template: params.template,
      metadata_uri: `rulebook://seed/${index + 1}`,
      is_public: true,
      author: SEED_AUTHOR,
      author_badge: seed.authorBadge,
      name: seed.name,
      description: seed.description,
      params_hash: ruleParamsHash(params),
      created_at: createdAt,
    });
  }
}
