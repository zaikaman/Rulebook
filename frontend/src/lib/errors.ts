import { toFunctionSelector } from 'viem';

/**
 * Every custom error declared in `contracts/src/shared/Errors.sol`, with the sentence a user
 * should read instead of a selector. `selector` stays attached, because the raw value is the
 * only way to match a failure against the chain.
 */
const ERROR_COPY: ReadonlyArray<{ signature: string; message: string }> = [
  { signature: 'NotOwner()', message: 'Only the owner can do this.' },
  {
    signature: 'InvalidVaultAuthorization()',
    message:
      'The Vault setup authorization is invalid or expired. Sign a fresh authorization and retry.',
  },
  { signature: 'NotAgent()', message: 'This call must come from your automation account.' },
  {
    signature: 'AgentAlreadyLinked()',
    message: 'This funds account is already linked to another automation account.',
  },
  {
    signature: 'AgentNotLinked()',
    message: 'This vault is not linked to the Agent yet. Finish setup before it can run rules.',
  },
  { signature: 'UnknownTemplate(uint8)', message: 'This rule type is not in the catalog.' },
  { signature: 'UnsupportedChain(uint16)', message: 'Rules cannot target this network.' },
  { signature: 'InvalidAmount()', message: 'That amount is not allowed for this rule.' },
  { signature: 'InvalidThreshold()', message: 'That threshold must be greater than zero.' },
  {
    signature: 'InvalidSecondary()',
    message: 'That band, expiry, or inactivity period is out of range.',
  },
  {
    signature: 'InvalidTemplateParams()',
    message: 'This sentence is missing a value it needs, or one value does not fit this rule type.',
  },
  {
    signature: 'RuleLimitReached(uint256,uint256)',
    message: 'You already have the maximum number of active rules. Pause or cancel one first.',
  },
  {
    signature: 'RuleNotActive(uint256)',
    message: 'That rule is not active, so this action does not apply.',
  },
  {
    signature: 'RuleLatched(uint256)',
    message: 'That rule already fired once. Reset it before it can fire again.',
  },
  {
    signature: 'ConditionNotMet()',
    message: 'The market no longer meets this rule, so nothing moved.',
  },
  {
    signature: 'ExceedsPerRunCap(uint256,uint256)',
    message: 'This amount is above the per-run ceiling. Lower the amount or raise the ceiling.',
  },
  {
    signature: 'MonthlyCapExceeded(uint256,uint256)',
    message:
      'Your active rules already reserve this month’s execution cap. Pause or cancel one, or lower an amount.',
  },
  {
    signature: 'SlippageExceeded(uint256,uint256)',
    message: 'The price moved too far between the decision and the swap, so it was refused.',
  },
  {
    signature: 'Expired(uint256,uint64)',
    message: 'This rule has expired and no longer runs.',
  },
  {
    signature: 'CooldownActive(uint256,uint64)',
    message: 'This rule is cooling down after its last run.',
  },
  {
    signature: 'InsufficientPrincipal(uint256,uint256)',
    message: 'The vault does not hold enough principal for this withdrawal.',
  },
  {
    signature: 'TransferFailed()',
    message: 'The token transfer failed. The vault has no allowance for it, or the token refused.',
  },
  {
    signature: 'NotServiceProvider()',
    message: 'Only the Reactive callback proxy may deliver this execution.',
  },
  {
    signature: 'CallbackSenderMismatch(address,address)',
    message: 'This callback did not come from the Agent that owns this vault.',
  },
  {
    signature: 'MirrorDepthNotAllowed()',
    message: 'Mirrors of mirrors are not allowed.',
  },
  {
    signature: 'MirrorBurstExceeded()',
    message: 'This mirror hit its hourly burst limit.',
  },
  {
    signature: 'DuplicateLeaderExecution(bytes32)',
    message: 'This leader execution was already mirrored.',
  },
  {
    signature: 'TokenMismatch(address,address)',
    message: 'This token is not the pair this vault allows.',
  },
];

export interface ContractErrorMessage {
  readonly selector: `0x${string}`;
  readonly message: string;
}

const BY_SELECTOR: ReadonlyMap<string, string> = new Map(
  ERROR_COPY.map((entry) => [toFunctionSelector(entry.signature), entry.message]),
);

/** The plain-language message for a selector, or null when it is not one of ours. */
export function humanizeSelector(selector: string): ContractErrorMessage | null {
  const normalized = selector.toLowerCase();
  const message = BY_SELECTOR.get(normalized);
  return message ? { selector: normalized as `0x${string}`, message } : null;
}

function findSelector(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['data', 'selector', 'revertData']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && /^0x[0-9a-fA-F]{8}/.test(candidate)) {
      return candidate.slice(0, 10).toLowerCase();
    }
  }
  return findSelector(record.cause, depth + 1) ?? findSelector(record.error, depth + 1);
}

/**
 * Turns any wallet, RPC, or simulation failure into copy a user can act on while keeping the
 * raw selector. A failure we do not recognise keeps its original message rather than being
 * rewritten into a guess.
 */
export function describeError(error: unknown): ContractErrorMessage | null {
  const selector = findSelector(error);
  if (selector) {
    const known = humanizeSelector(selector);
    if (known) return known;
    return { selector: selector as `0x${string}`, message: 'The contract refused this request.' };
  }
  return null;
}
