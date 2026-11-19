import {
  BaseError,
  LimitExceededRpcError,
  toFunctionSelector,
  UnauthorizedProviderError,
  UserRejectedRequestError,
  type Hex,
} from 'viem';

export class SetupTransactionError extends Error {
  constructor(
    readonly chainId: number,
    readonly txHash: Hex,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'SetupTransactionError';
  }
}

export class WalletAuthorizationError extends Error {
  constructor(
    readonly chainId: number,
    cause?: unknown,
  ) {
    super(
      'Your wallet blocked this request. Disconnect this site in your wallet’s permissions, then reconnect with the same account and allow the requested network.',
      { cause },
    );
    this.name = 'WalletAuthorizationError';
  }
}

export function isWalletUnauthorized(error: unknown): boolean {
  const matches = (candidate: unknown) =>
    candidate instanceof UnauthorizedProviderError ||
    (typeof candidate === 'object' &&
      candidate !== null &&
      'code' in candidate &&
      candidate.code === UnauthorizedProviderError.code);

  return error instanceof BaseError ? Boolean(error.walk(matches)) : matches(error);
}

/** Wallets can wrap broadcast throttling in a generic RPC error, which viem may label a revert. */
export function isRpcRateLimit(error: unknown, depth = 0): boolean {
  if (typeof error === 'string') return /\b(?:rate[ -]limit|too many requests)/i.test(error);
  if (depth > 6 || typeof error !== 'object' || error === null) return false;
  const detail = error as Record<string, unknown>;
  if (detail.code === LimitExceededRpcError.code || detail.code === 429 || detail.status === 429) {
    return true;
  }
  return ['message', 'details', 'cause', 'data', 'originalError', 'error'].some((key) =>
    isRpcRateLimit(detail[key], depth + 1),
  );
}

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
    signature: 'StaleExecution(uint256,uint32)',
    message: 'The vault already processed this execution or a newer one.',
  },
  {
    signature: 'TokenMismatch(address,address)',
    message: 'This token is not the pair this vault allows.',
  },
  {
    signature: 'AlertOnlyTemplate(uint8)',
    message:
      'This rule type only alerts you. It never moves funds, so there is nothing to execute.',
  },
  {
    signature: 'InvalidCallbackPayload()',
    message: 'The execution callback did not match this rule, so the vault refused it.',
  },
  {
    signature: 'RegistryNotConfigured()',
    message: 'Publishing rules is not configured on this deployment.',
  },
];

/** True when a wallet prompt was rejected by the user rather than failing for another reason. */
export function isWalletRejection(error: unknown): boolean {
  if (error && typeof error === 'object') {
    if (
      ('code' in error && error.code === UserRejectedRequestError.code) ||
      ('name' in error && error.name === 'UserRejectedRequestError')
    ) {
      return true;
    }
  }
  return error instanceof Error && /rejected|denied|cancelled|canceled/i.test(error.message);
}

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
