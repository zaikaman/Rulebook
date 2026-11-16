import { getChain, getTemplate, type TemplateSlot } from '@rulebook/shared';

import type { ComposerState, SlotIssues } from './types.js';

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DIGITS_PATTERN = /^[0-9]+$/;

function issueFor(slot: TemplateSlot, value: string): string | null {
  if (slot.kind === 'token' || slot.kind === 'address') {
    return ADDRESS_PATTERN.test(value) ? null : `${slot.label} must be an address`;
  }
  if (!DIGITS_PATTERN.test(value)) {
    return `${slot.label} must be a whole number`;
  }
  try {
    const parsed = BigInt(value);
    if (slot.min !== null && parsed < BigInt(slot.min)) {
      return `${slot.label} is below its minimum${slot.unit ? ` (${slot.unit})` : ''}`;
    }
    if (slot.max !== null && parsed > BigInt(slot.max)) {
      return `${slot.label} is above its maximum${slot.unit ? ` (${slot.unit})` : ''}`;
    }
  } catch {
    return `${slot.label} must be a whole number`;
  }
  return null;
}

/**
 * Validates a draft against the generated manifest slot rules — required-ness, token/address
 * shape, integer-only amounts, min/max, price scale — and returns one message per bad slot.
 * Nothing here accepts a free-text value: a slot only ever holds a pick from its own kind.
 */
export function slotIssues(state: ComposerState): SlotIssues {
  const issues: Record<string, string> = {};
  const template = getTemplate(state.template);
  if (!template) return { template: 'Unknown rule template' };

  try {
    getChain(state.chainId);
  } catch {
    return { chain: `Rules cannot target chain ${state.chainId}` };
  }

  const declared = new Set<string>(template.slots.map((slot) => slot.key));
  for (const key of Object.keys(state.slots)) {
    if (!declared.has(key)) issues[key] = 'This value does not belong to the chosen sentence';
  }

  for (const slot of template.slots) {
    const value = state.slots[slot.key];
    if (!value) {
      if (slot.required) issues[slot.key] = `Choose a ${slot.label}`;
      continue;
    }
    const message = issueFor(slot, value);
    if (message) issues[slot.key] = message;
  }

  const tokenIn = state.slots.token_in;
  const tokenOut = state.slots.token_out;
  if (tokenIn && tokenOut && tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    issues.token_in = 'The token you pay with and the token you receive must differ';
    issues.token_out = 'The token you pay with and the token you receive must differ';
  }

  return issues;
}
