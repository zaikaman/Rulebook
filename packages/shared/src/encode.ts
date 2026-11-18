/**
 * The one rule encoder. The composer, the `/v1/encode/preview` route, and the contract test
 * fixtures all call this function, so client and server calldata cannot disagree.
 */
import { encodeAbiParameters, encodeFunctionData, keccak256, type Address } from 'viem';

import { agentAbi } from './abi/index.js';
import { getChain } from './chains.js';
import { getTemplate, type TemplateDefinition, type TemplateSlot } from './generated/templates.js';

export interface RuleDraft {
  readonly template: number;
  readonly chainId: number;
  readonly slots: Readonly<Record<string, string>>;
}

export type DraftErrorCode =
  | 'unknown_template'
  | 'unsupported_chain'
  | 'unknown_slot'
  | 'invalid_slot'
  | 'incomplete'
  | 'conflicting_tokens';

/** A rejected draft, carrying the offending slot keys for direct UI highlighting. */
export class DraftError extends Error {
  constructor(
    readonly code: DraftErrorCode,
    message: string,
    readonly slots: readonly string[] = [],
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DIGITS_PATTERN = /^[0-9]+$/;

function requireTemplate(draft: RuleDraft): TemplateDefinition {
  const template = getTemplate(draft.template);
  if (!template) {
    throw new DraftError('unknown_template', `Unknown template ${draft.template}`, ['template']);
  }
  return template;
}

function assertKnownSlots(template: TemplateDefinition, draft: RuleDraft): void {
  const known: ReadonlySet<string> = new Set(template.slots.map((slot) => slot.key));
  const unknown = Object.keys(draft.slots).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new DraftError(
      'unknown_slot',
      `Unknown slot(s) for template ${template.id}: ${unknown.join(', ')}`,
      unknown,
    );
  }
}

function slotValue(draft: RuleDraft, key: string): string | undefined {
  const value = draft.slots[key];
  return value && value.length > 0 ? value : undefined;
}

function assertSlotValue(slot: TemplateSlot, value: string): void {
  if (slot.kind === 'token' || slot.kind === 'address') {
    if (!ADDRESS_PATTERN.test(value)) {
      throw new DraftError('invalid_slot', `${slot.label} must be an address`, [slot.key]);
    }
    return;
  }
  if (!DIGITS_PATTERN.test(value)) {
    throw new DraftError('invalid_slot', `${slot.label} must be a whole number`, [slot.key]);
  }
  const parsed = BigInt(value);
  if (slot.min !== null && parsed < BigInt(slot.min)) {
    throw new DraftError('invalid_slot', `${slot.label} is below its minimum`, [slot.key]);
  }
  if (slot.max !== null && parsed > BigInt(slot.max)) {
    throw new DraftError('invalid_slot', `${slot.label} is above its maximum`, [slot.key]);
  }
}

/** Validates a draft and returns its required-but-unfilled slot keys. */
export function missingSlots(draft: RuleDraft): string[] {
  const template = requireTemplate(draft);
  getChain(draft.chainId);
  assertKnownSlots(template, draft);
  for (const slot of template.slots) {
    const value = slotValue(draft, slot.key);
    if (value) assertSlotValue(slot, value);
  }
  return template.slots
    .filter((slot) => slot.required && slotValue(draft, slot.key) === undefined)
    .map((slot) => slot.key);
}

/** Renders the template sentence with the draft's values; missing slots stay labelled. */
export function readableSentence(draft: RuleDraft): string {
  const template = requireTemplate(draft);
  return template.sentence.replace(/\{([a-z_]+)\}/g, (_match, key: string) => {
    const value = slotValue(draft, key);
    if (value) return value;
    const slot = template.slots.find((candidate) => candidate.key === key);
    return `[${slot?.label ?? key}]`;
  });
}

/** True when both token slots are present and identical. */
function assertDistinctTokens(draft: RuleDraft): void {
  const tokenIn = slotValue(draft, 'token_in');
  const tokenOut = slotValue(draft, 'token_out');
  if (tokenIn && tokenOut && tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new DraftError(
      'conflicting_tokens',
      'The token you pay with and the token you receive must differ',
      ['token_in', 'token_out'],
    );
  }
}

function numericSlot(draft: RuleDraft, key: string): bigint {
  const value = slotValue(draft, key);
  return value ? BigInt(value) : 0n;
}

/**
 * Encodes the `addRule` call for a draft. Rejects any unknown slot key, any value that is not
 * a number/address of the expected kind, and identical input/output tokens.
 */
export function encodeAddRule(
  agentAddress: Address,
  draft: RuleDraft,
  options: { readonly makePublic?: boolean } = {},
): `0x${string}` {
  return encodeAddRuleParams(agentAddress, ruleParamsFromDraft(draft), options);
}

/** Encodes `addRule` from parameters that already came from a stored rule (the clone path). */
export function encodeAddRuleParams(
  _agentAddress: Address,
  params: RuleParams,
  options: { readonly makePublic?: boolean } = {},
): `0x${string}` {
  return encodeFunctionData({
    abi: agentAbi,
    functionName: 'addRule',
    args: [
      {
        template: params.template,
        chainId: params.chainId,
        flags: 0,
        pair: params.pair,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        threshold: params.threshold,
        secondary: params.secondary,
        lastRun: 0n,
        runs: 0,
      },
      options.makePublic ?? false,
    ],
  });
}

/** The user-chosen parameters of a rule, exactly as `RuleLib.paramsHash` sees them. */
export interface RuleParams {
  readonly template: number;
  readonly chainId: number;
  readonly pair: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  readonly threshold: bigint;
  readonly secondary: bigint;
}

/**
 * Maps a draft to the on-chain parameters. This is the inverse of `draftFromRule` and the single
 * place the slot-to-field mapping lives, so calldata, the registry hash, and a clone agree.
 */
export function ruleParamsFromDraft(draft: RuleDraft): RuleParams {
  const template = requireTemplate(draft);
  getChain(draft.chainId);
  assertKnownSlots(template, draft);
  assertDistinctTokens(draft);

  const missing = missingSlots(draft);
  if (missing.length > 0) {
    throw new DraftError('incomplete', `Missing slot(s): ${missing.join(', ')}`, missing);
  }

  // The Rule struct has one numeric field per role, so two slot keys share a field when a
  // template declares both. A schedule always lands in `secondary` unless that template also
  // uses `secondary` (a dip band or inactivity period), in which case it uses `threshold`.
  const hasSlot = (key: string): boolean => template.slots.some((slot) => slot.key === key);
  const schedule = numericSlot(draft, 'schedule');
  const threshold =
    hasSlot('schedule') && hasSlot('secondary') ? schedule : numericSlot(draft, 'threshold');
  const secondary =
    hasSlot('schedule') && !hasSlot('secondary') ? schedule : numericSlot(draft, 'secondary');

  // Personal templates use `pair`, which is otherwise a price-pair field, for their recipient.
  // Templates that move money without exposing a pair still need one on chain (the Agent caches
  // a price for it), so they fall back to the chain's canonical pool.
  const recipient = slotValue(draft, 'destination') ?? slotValue(draft, 'source_wallet');
  const pair = (slotValue(draft, 'pair') ?? recipient ?? getChain(draft.chainId).pair) as Address;

  return {
    template: draft.template,
    chainId: draft.chainId,
    pair,
    tokenIn: (slotValue(draft, 'token_in') ?? ZERO_ADDRESS) as Address,
    tokenOut: (slotValue(draft, 'token_out') ?? ZERO_ADDRESS) as Address,
    amountIn: numericSlot(draft, 'amount_in'),
    threshold,
    secondary,
  };
}

/**
 * Stable hash of the user-chosen parameters, byte-for-byte identical to `RuleLib.paramsHash`.
 * The registry publishes it, so a clone can prove it rebuilt the author's exact rule.
 */
export function ruleParamsHash(params: RuleParams): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint8' },
        { type: 'uint16' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [
        params.template,
        params.chainId,
        params.pair,
        params.tokenIn,
        params.tokenOut,
        params.amountIn,
        params.threshold,
        params.secondary,
      ],
    ),
  );
}

/** The rule fields the read model returns, used to rebuild a sentence. */
export interface StoredRuleFields {
  readonly template: number;
  readonly chain_id: number;
  readonly pair?: string | undefined;
  readonly token_in?: string | undefined;
  readonly token_out?: string | undefined;
  readonly amount_in?: bigint | undefined;
  readonly threshold?: bigint | undefined;
  readonly secondary?: bigint | undefined;
  readonly destination?: string | undefined;
}

/**
 * Rebuilds a draft from stored rule parameters so a rule can be rendered as the exact sentence
 * its owner signed. This is the inverse of `encodeAddRule`'s slot mapping, including the
 * schedule field shared with `secondary`/`threshold` and the recipient stored in `pair`.
 */
export function draftFromRule(rule: StoredRuleFields): RuleDraft {
  const template = getTemplate(rule.template);
  if (!template) {
    throw new DraftError('unknown_template', `Unknown template ${rule.template}`, ['template']);
  }
  const hasSlot = (key: string): boolean => template.slots.some((slot) => slot.key === key);
  const slots: Record<string, string> = {};

  if (rule.pair) {
    if (hasSlot('pair')) slots.pair = rule.pair;
    else if (hasSlot('destination')) slots.destination = rule.pair;
    else if (hasSlot('source_wallet')) slots.source_wallet = rule.pair;
  }
  if (rule.token_in) slots.token_in = rule.token_in;
  if (rule.token_out) slots.token_out = rule.token_out;
  if (rule.amount_in !== undefined && rule.amount_in > 0n)
    slots.amount_in = rule.amount_in.toString();

  const threshold = rule.threshold?.toString();
  const secondary = rule.secondary?.toString();
  if (hasSlot('schedule')) {
    const schedule = hasSlot('secondary') ? threshold : secondary;
    if (schedule) slots.schedule = schedule;
  }
  if (hasSlot('threshold') && threshold) slots.threshold = threshold;
  if (hasSlot('secondary') && secondary) slots.secondary = secondary;

  return { template: rule.template, chainId: rule.chain_id, slots };
}
