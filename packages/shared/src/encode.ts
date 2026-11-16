/**
 * The one rule encoder. The composer, the `/v1/encode/preview` route, and the contract test
 * fixtures all call this function, so client and server calldata cannot disagree.
 */
import { encodeFunctionData, type Address } from 'viem';

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
export function encodeAddRule(agentAddress: Address, draft: RuleDraft): `0x${string}` {
  const template = requireTemplate(draft);
  const chain = getChain(draft.chainId);
  assertKnownSlots(template, draft);
  assertDistinctTokens(draft);

  const missing = missingSlots(draft);
  if (missing.length > 0) {
    throw new DraftError('incomplete', `Missing slot(s): ${missing.join(', ')}`, missing);
  }

  const wantsPair = template.slots.some((slot) => slot.key === 'pair');
  const pair = (slotValue(draft, 'pair') ?? (wantsPair ? chain.pair : ZERO_ADDRESS)) as Address;
  const tokenIn = (slotValue(draft, 'token_in') ?? ZERO_ADDRESS) as Address;
  const tokenOut = (slotValue(draft, 'token_out') ?? ZERO_ADDRESS) as Address;

  return encodeFunctionData({
    abi: agentAbi,
    functionName: 'addRule',
    args: [
      {
        template: draft.template,
        chainId: draft.chainId,
        flags: 0,
        pair,
        tokenIn,
        tokenOut,
        amountIn: numericSlot(draft, 'amount_in'),
        threshold: numericSlot(draft, 'threshold'),
        secondary: numericSlot(draft, 'secondary'),
        lastRun: 0n,
        runs: 0,
      },
      false,
    ],
  });
}
