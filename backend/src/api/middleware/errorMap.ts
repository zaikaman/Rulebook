import { toFunctionSelector } from 'viem';

/** A user-facing translation that always keeps the raw selector (FR-051). */
export interface MappedContractError {
  readonly selector: string;
  readonly code: string;
  readonly message: string;
  readonly human: string;
}

const DESCRIPTORS: ReadonlyArray<{
  signature: string;
  code: string;
  human: string;
}> = [
  { signature: 'NotOwner()', code: 'not_owner', human: 'Only the owner can do that.' },
  {
    signature: 'InvalidVaultAuthorization()',
    code: 'invalid_vault_authorization',
    human:
      'The Vault setup authorization is invalid or expired. Sign a fresh authorization and retry.',
  },
  { signature: 'NotAgent()', code: 'not_agent', human: 'That caller is not the linked agent.' },
  {
    signature: 'AgentAlreadyLinked()',
    code: 'agent_already_linked',
    human: 'This account already has an agent or vault; resume instead of redeploying.',
  },
  {
    signature: 'AgentNotLinked()',
    code: 'agent_not_linked',
    human: 'This vault is not linked to its agent yet; finish onboarding before it can run.',
  },
  {
    signature: 'UnknownTemplate(uint8)',
    code: 'unknown_template',
    human: 'That rule template is not in the catalog.',
  },
  {
    signature: 'UnsupportedChain(uint16)',
    code: 'unsupported_chain',
    human: 'That network is not supported by this release.',
  },
  { signature: 'InvalidAmount()', code: 'invalid_amount', human: 'The amount is not valid.' },
  {
    signature: 'InvalidThreshold()',
    code: 'invalid_threshold',
    human: 'The threshold is missing or invalid.',
  },
  {
    signature: 'InvalidSecondary()',
    code: 'invalid_secondary',
    human: 'The band, expiry, or inactivity value is out of range.',
  },
  {
    signature: 'InvalidTemplateParams()',
    code: 'invalid_template_params',
    human: 'The rule is missing a parameter its template requires.',
  },
  {
    signature: 'RuleLimitReached(uint256,uint256)',
    code: 'rule_limit_reached',
    human: 'You have reached the maximum number of active rules.',
  },
  {
    signature: 'RuleNotActive(uint256)',
    code: 'rule_not_active',
    human: 'That rule is not active.',
  },
  {
    signature: 'RuleLatched(uint256)',
    code: 'rule_latched',
    human: 'That rule already fired and must be re-armed.',
  },
  {
    signature: 'ConditionNotMet()',
    code: 'condition_not_met',
    human: 'The rule condition no longer holds, so nothing was executed.',
  },
  {
    signature: 'ExceedsPerRunCap(uint256,uint256)',
    code: 'exceeds_per_run_cap',
    human: 'The amount is above this vault’s per-run spend ceiling.',
  },
  {
    signature: 'MonthlyCapExceeded(uint256,uint256)',
    code: 'monthly_cap_exceeded',
    human:
      'Your active rules already reserve this month’s execution cap. Pause or cancel one, or lower an amount.',
  },
  {
    signature: 'SlippageExceeded(uint256,uint256)',
    code: 'slippage_exceeded',
    human: 'The live quote moved past your minimum acceptable output.',
  },
  { signature: 'Expired(uint256,uint64)', code: 'expired', human: 'That rule has expired.' },
  {
    signature: 'CooldownActive(uint256,uint64)',
    code: 'cooldown_active',
    human: 'The rule is cooling down before it can fire again.',
  },
  {
    signature: 'InsufficientPrincipal(uint256,uint256)',
    code: 'insufficient_principal',
    human: 'The vault does not hold enough principal for that withdrawal.',
  },
  {
    signature: 'TransferFailed()',
    code: 'transfer_failed',
    human: 'The token transfer failed.',
  },
  {
    signature: 'NotServiceProvider()',
    code: 'not_service_provider',
    human: 'Only the Reactive callback proxy may call this function.',
  },
  {
    signature: 'CallbackSenderMismatch(address,address)',
    code: 'callback_sender_mismatch',
    human: 'The callback came from a different agent than the one this vault trusts.',
  },
  {
    signature: 'MirrorDepthNotAllowed()',
    code: 'mirror_depth_not_allowed',
    human: 'A mirrored execution cannot itself be mirrored.',
  },
  {
    signature: 'MirrorBurstExceeded()',
    code: 'mirror_burst_exceeded',
    human: 'This mirror hit its hourly execution limit.',
  },
  {
    signature: 'DuplicateLeaderExecution(bytes32)',
    code: 'duplicate_leader_execution',
    human: 'This leader execution was already mirrored once.',
  },
  {
    signature: 'TokenMismatch(address,address)',
    code: 'token_mismatch',
    human: 'The token does not match the allowlisted pair.',
  },
];

const BY_SELECTOR = new Map<string, MappedContractError>(
  DESCRIPTORS.map((descriptor) => {
    const selector = toFunctionSelector(descriptor.signature);
    return [
      selector,
      { selector, code: descriptor.code, message: descriptor.signature, human: descriptor.human },
    ];
  }),
);

/**
 * Maps revert data or a bare selector to a user-facing error. The raw selector is always
 * preserved next to the explanation. Returns `null` for unrecognised selectors so callers can
 * fall back without inventing a message.
 */
export function mapContractError(input: string): MappedContractError | null {
  if (!input.startsWith('0x')) return null;
  const selector = input.length > 10 ? input.slice(0, 10).toLowerCase() : input.toLowerCase();
  return BY_SELECTOR.get(selector) ?? null;
}

/** All selectors the map knows, used by the parity test. */
export function knownSelectors(): string[] {
  return [...BY_SELECTOR.keys()];
}
