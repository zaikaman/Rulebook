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
  {
    signature: 'InvalidProgram()',
    message: 'This workflow program violates an on-chain validation rule.',
  },
  {
    signature: 'Unauthorized()',
    message: 'Only the authorized account or proxy can perform this action.',
  },
  {
    signature: 'InvalidAuthorization()',
    message: 'This workflow authorization is invalid or expired.',
  },
  {
    signature: 'StaleBudget()',
    message: 'The weekly budget changed on-chain. Refresh and try again.',
  },
  {
    signature: 'CapExceeded()',
    message: 'This execution exceeds the workflow per-run cap.',
  },
  {
    signature: 'WeeklyBudgetExceeded()',
    message: 'This execution exceeds the weekly spending budget.',
  },
  {
    signature: 'DuplicateOrigin()',
    message: 'This event was already processed.',
  },
  {
    signature: 'StaleObservation()',
    message: 'This observation is older than the latest recorded run.',
  },
  {
    signature: 'SettlementInterrupted()',
    message: 'Settlement was interrupted and could not complete.',
  },
  {
    signature: 'InsufficientVaultBalance(address,uint256,uint256)',
    message: 'The Vault does not hold enough balance for this action.',
  },
  {
    signature: 'InvalidMarket()',
    message: 'The pool market configuration is invalid.',
  },
  {
    signature: 'NoLongerEligible()',
    message: 'The market conditions are no longer met for this swap.',
  },
  {
    signature: 'AgentMismatch()',
    message: 'This Vault is linked to a different Agent.',
  },
  {
    signature: 'InactiveDeployment()',
    message: 'This workflow deployment is inactive.',
  },
  {
    signature: 'InvalidListing()',
    message: 'This marketplace listing is invalid.',
  },
  {
    signature: 'InvalidWorkflow()',
    message: 'This workflow cannot be activated in its current state.',
  },
  {
    signature: 'NotPaused()',
    message: 'Pause the workflow before performing this action.',
  },
  {
    signature: 'BudgetBlocked()',
    message: 'The execution credit balance is too low to continue.',
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
  for (const key of ['data', 'selector', 'revertData', 'raw', 'signature']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && /^0x[0-9a-fA-F]{8}/.test(candidate)) {
      return candidate.slice(0, 10).toLowerCase();
    }
  }
  for (const key of ['cause', 'error', 'data', 'originalError']) {
    const nested = findSelector(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
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

const HEX_SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;
const GENERIC_REVERT_RE = /^execution reverted\.?$/i;
const DIAGNOSTIC_SECTION_RE =
  /^(?:Request Arguments|Contract Call|Raw Call Arguments|Estimate Gas Arguments|Docs|Version):/;

interface RevertDetails {
  reason?: string;
  errorName?: string;
  details?: string;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function collectRevertDetails(error: unknown, depth = 0, out: RevertDetails = {}): RevertDetails {
  if (depth > 6 || error === null || typeof error !== 'object') return out;
  const record = error as Record<string, unknown>;
  if (typeof record.reason === 'string') {
    const reason = normalizeInline(record.reason);
    if (reason && !HEX_SELECTOR_RE.test(reason) && !GENERIC_REVERT_RE.test(reason) && !out.reason) {
      out.reason = reason;
    }
  }
  if (record.data && typeof record.data === 'object') {
    const errorName = (record.data as Record<string, unknown>).errorName;
    if (
      typeof errorName === 'string' &&
      errorName.trim() &&
      errorName !== 'Error' &&
      errorName !== 'Panic' &&
      !out.errorName
    ) {
      out.errorName = errorName.trim();
    }
  }
  if (typeof record.details === 'string') {
    const details = normalizeInline(record.details);
    if (details && !HEX_SELECTOR_RE.test(details) && !GENERIC_REVERT_RE.test(details)) {
      out.details = details;
    }
  }
  for (const key of ['cause', 'error', 'originalError']) {
    collectRevertDetails(record[key], depth + 1, out);
  }
  return out;
}

function formatPlainErrorMessage(message: string): string | undefined {
  const summaryLines: string[] = [];
  let details: string | undefined;
  for (const rawLine of message.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (DIAGNOSTIC_SECTION_RE.test(line)) break;
    if (line.startsWith('Details:')) {
      const candidate = normalizeInline(line.slice('Details:'.length));
      if (candidate && !HEX_SELECTOR_RE.test(candidate) && !GENERIC_REVERT_RE.test(candidate)) {
        details = candidate;
      }
      continue;
    }
    summaryLines.push(line);
  }
  const summary = summaryLines.join(' ').trim();
  if (!summary) return details;
  return appendDetailsIfMissing(summary, details);
}

function appendDetailsIfMissing(summary: string, details: string | undefined): string {
  if (!details) return summary;
  if (summary.toLowerCase().includes(details.toLowerCase())) return summary;
  return summary.endsWith(':') ? `${summary} ${details}` : `${summary} (${details})`;
}

/** Returns a concise human-readable message for contract reverts and wallet errors. */
export function formatContractError(error: unknown, fallback: string): string {
  const described = describeError(error);
  if (described && described.message !== 'The contract refused this request.') {
    return described.message;
  }
  const { reason, errorName, details } = collectRevertDetails(error);
  if (error instanceof BaseError) {
    const lines = error.shortMessage
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (reason) {
      const header = lines[0]?.endsWith(':') ? `${lines[0]} ` : '';
      return `${header}${reason}`;
    }
    const remainder = lines.slice(1).join(' ').trim();
    if (lines[0]?.endsWith(':') && HEX_SELECTOR_RE.test(remainder) && described?.message) {
      return described.message;
    }
    let summary = lines.join(' ').trim();
    if (summary.endsWith(':') && errorName) {
      summary = `${summary} ${errorName}`;
    }
    if (summary && !summary.endsWith(':')) {
      return appendDetailsIfMissing(summary, details);
    }
    if (summary && details) {
      return appendDetailsIfMissing(summary, details);
    }
    return described?.message ?? formatPlainErrorMessage(error.message) ?? fallback;
  }
  if (reason) return reason;
  if (error instanceof Error) {
    return formatPlainErrorMessage(error.message) ?? fallback;
  }
  return fallback;
}
