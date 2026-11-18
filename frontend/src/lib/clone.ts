import {
  ruleParamsHash,
  type Listing,
  type Rule,
  type RuleParams,
} from '@rulebook/shared';

/** Mirrors `RuleLib.MAX_ACTIVE_RULES`; a wallet is never shown a clone the Agent would reject. */
export const MAX_ACTIVE_RULES = 5;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Rebuilds the hashed parameters from the read model's stored rule fields. */
export function ruleParamsFromStoredRule(rule: Rule): RuleParams {
  return {
    template: rule.template,
    chainId: rule.chain_id,
    pair: (rule.pair ?? ZERO_ADDRESS) as `0x${string}`,
    tokenIn: (rule.token_in ?? ZERO_ADDRESS) as `0x${string}`,
    tokenOut: (rule.token_out ?? ZERO_ADDRESS) as `0x${string}`,
    amountIn: rule.amount_in ?? 0n,
    threshold: rule.threshold ?? 0n,
    secondary: rule.secondary ?? 0n,
  };
}

/**
 * True only when the rule the API returned hashes to the hash the registry published. A clone
 * is refused when this fails, because rebuilding different parameters would copy a different
 * rule under the author's name.
 */
export function cloneHashMatches(rule: Rule, listing: Listing): boolean {
  if (!listing.params_hash) return false;
  return ruleParamsHash(ruleParamsFromStoredRule(rule)) === listing.params_hash;
}

export type CloneGuardCode =
  | 'no_agent'
  | 'rule_limit'
  | 'unsupported_template'
  | 'vault_ceiling'
  | 'hash_mismatch'
  | 'missing_hash';

export interface CloneGuardInput {
  readonly hasAgent: boolean;
  readonly activeRuleCount: number;
  readonly template: number;
  readonly supportedTemplates: readonly number[];
  /** The cloner's per-run ceiling; `null` when its vault is not readable yet. */
  readonly vaultCeiling: bigint | null;
  readonly amountIn: bigint;
  readonly paramsHash: string | null | undefined;
  readonly expectedHash: string | null | undefined;
}

export type CloneGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: CloneGuardCode; readonly message: string };

const OK: CloneGuardResult = { ok: true };

/**
 * Every reason a one-click clone must be refused before a signature. The checks run in the
 * order the user would hit them, and each carries a specific, actionable message.
 */
export function cloneGuard(input: CloneGuardInput): CloneGuardResult {
  if (!input.hasAgent) {
    return {
      ok: false,
      code: 'no_agent',
      message: 'Create your automation account before cloning a rule.',
    };
  }
  if (input.activeRuleCount >= MAX_ACTIVE_RULES) {
    return {
      ok: false,
      code: 'rule_limit',
      message: `You already have ${MAX_ACTIVE_RULES} active rules. Pause or cancel one before cloning.`,
    };
  }
  if (!input.supportedTemplates.includes(input.template)) {
    return {
      ok: false,
      code: 'unsupported_template',
      message: 'This template is not supported on your funds network.',
    };
  }
  if (input.vaultCeiling !== null && input.amountIn > input.vaultCeiling) {
    return {
      ok: false,
      code: 'vault_ceiling',
      message: "This rule spends more than your vault's per-run ceiling. Raise the ceiling first.",
    };
  }
  if (!input.paramsHash || !input.expectedHash) {
    return {
      ok: false,
      code: 'missing_hash',
      message: 'This listing has no published parameter hash, so it cannot be copied exactly.',
    };
  }
  if (input.paramsHash.toLowerCase() !== input.expectedHash.toLowerCase()) {
    return {
      ok: false,
      code: 'hash_mismatch',
      message:
        'The published rule no longer matches its listing. Refusing to copy different parameters.',
    };
  }
  return OK;
}
