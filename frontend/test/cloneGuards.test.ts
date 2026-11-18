import { ruleParamsHash, type RuleParams } from '@rulebook/shared';
import { describe, expect, it } from 'vitest';

import {
  cloneGuard,
  cloneHashMatches,
  MAX_ACTIVE_RULES,
  ruleParamsFromStoredRule,
  type CloneGuardInput,
} from '../src/lib/clone.js';
import type { Rule } from '@rulebook/shared';

const PARAMS: RuleParams = {
  template: 1,
  chainId: 1301,
  pair: '0x0000000000000000000000000000000000000000',
  tokenIn: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
  tokenOut: '0x4200000000000000000000000000000000000006',
  amountIn: 10_000_000n,
  threshold: 0n,
  secondary: 604_800n,
};

const HASH = ruleParamsHash(PARAMS);

function input(overrides: Partial<CloneGuardInput> = {}): CloneGuardInput {
  return {
    hasAgent: true,
    activeRuleCount: 1,
    template: 1,
    supportedTemplates: [1, 3, 5, 11],
    vaultCeiling: 100_000_000n,
    amountIn: 10_000_000n,
    paramsHash: HASH,
    expectedHash: HASH,
    ...overrides,
  };
}

describe('cloneGuard', () => {
  it('allows a clone when every precondition holds', () => {
    expect(cloneGuard(input())).toEqual({ ok: true });
  });

  it('asks the cloner to create an account first', () => {
    const result = cloneGuard(input({ hasAgent: false }));

    expect(result).toMatchObject({ ok: false, code: 'no_agent' });
    if (!result.ok) expect(result.message).toMatch(/account/i);
  });

  it('refuses the sixth active rule with the limit named', () => {
    const result = cloneGuard(input({ activeRuleCount: MAX_ACTIVE_RULES }));

    expect(result).toMatchObject({ ok: false, code: 'rule_limit' });
    if (!result.ok) expect(result.message).toContain(String(MAX_ACTIVE_RULES));
  });

  it('refuses a template the funds network cannot express', () => {
    const result = cloneGuard(input({ template: 2, supportedTemplates: [1, 3] }));

    expect(result).toMatchObject({ ok: false, code: 'unsupported_template' });
  });

  it('refuses an amount above the cloner’s per-run ceiling', () => {
    const result = cloneGuard(input({ vaultCeiling: 9_999_999n }));

    expect(result).toMatchObject({ ok: false, code: 'vault_ceiling' });
    if (!result.ok) expect(result.message).toMatch(/ceiling/i);
  });

  it('allows a clone at exactly the ceiling', () => {
    expect(cloneGuard(input({ vaultCeiling: PARAMS.amountIn }))).toEqual({ ok: true });
  });

  it('does not block when the vault ceiling is not readable yet', () => {
    expect(cloneGuard(input({ vaultCeiling: null }))).toEqual({ ok: true });
  });

  it('refuses a listing with no published parameter hash', () => {
    const result = cloneGuard(input({ expectedHash: null }));

    expect(result).toMatchObject({ ok: false, code: 'missing_hash' });
  });

  it('refuses when the rebuilt parameters hash differently from the listing', () => {
    const result = cloneGuard(input({ paramsHash: `0x${'11'.repeat(32)}` }));

    expect(result).toMatchObject({ ok: false, code: 'hash_mismatch' });
    if (!result.ok) expect(result.message).toMatch(/refusing/i);
  });
});

describe('cloneHashMatches', () => {
  const rule: Rule = {
    agent: '0x5eed000000000000000000000000000000000001',
    rule_id: 1n,
    template: 1,
    chain_id: 1301,
    status: 'active',
    latched: false,
    pair: PARAMS.pair,
    token_in: PARAMS.tokenIn,
    token_out: PARAMS.tokenOut,
    amount_in: PARAMS.amountIn,
    threshold: PARAMS.threshold,
    secondary: PARAMS.secondary,
    runs: 0,
    is_public: true,
  };

  const listing = {
    listing_id: 1n,
    agent: '0x5eed000000000000000000000000000000000001' as const,
    rule_id: 1n,
    template: 1,
    author: '0x7ea0000000000000000000000000000000000001' as const,
    author_badge: 'team' as const,
    runs: 0,
    success_rate: 0,
    cloned_count: 0,
    params_hash: HASH,
  };

  it('rebuilds the published parameters from the stored rule', () => {
    expect(ruleParamsFromStoredRule(rule)).toEqual(PARAMS);
  });

  it('matches only the hash the registry published', () => {
    expect(cloneHashMatches(rule, listing)).toBe(true);
    expect(cloneHashMatches(rule, { ...listing, params_hash: `0x${'00'.repeat(32)}` })).toBe(false);
    expect(cloneHashMatches(rule, { ...listing, params_hash: undefined })).toBe(false);
  });
});
