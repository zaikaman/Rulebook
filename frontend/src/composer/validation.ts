import { getChain, getTemplate, type TemplateSlot } from '@rulebook/shared';
import { isAddress, zeroAddress } from 'viem';

import { knownToken } from '../lib/signatures.js';
import { amountCeiling, parseDecimalAmount, tokenAmount } from './amounts.js';
import { isExpirySlot, slotBoundMessage, textToCanonical } from './numericFields.js';
import { READY_DRAFT, type ComposerState, type ReadyDraft, type VaultTerms } from './types.js';

function addressIssue(value: string): string | null {
  return isAddress(value) && value !== zeroAddress ? null : 'Enter a valid, non-zero address.';
}

function emptyIssue(slot: TemplateSlot): string {
  if (slot.kind === 'amount') return 'Enter an amount.';
  if (slot.kind === 'token' || slot.kind === 'address') return 'Choose a value.';
  return 'Enter a value.';
}

/** Validate human-scale input and build the same canonical draft for preview and signing. */
export function validateComposer(
  state: ComposerState,
  vault?: VaultTerms,
): { issues: Record<string, string>; draft: ReadyDraft | null } {
  const issues: Record<string, string> = {};
  const template = getTemplate(state.template);
  if (!template) return { issues: { template: 'Unknown rule template' }, draft: null };

  try {
    getChain(state.chainId);
  } catch {
    return { issues: { chain: `Rules cannot target chain ${state.chainId}` }, draft: null };
  }

  const declared = new Set<string>(template.slots.map((slot) => slot.key));
  for (const key of Object.keys(state.slots)) {
    if (!declared.has(key)) issues[key] = 'This value does not belong to the chosen rule';
  }

  const slots = { ...state.slots };
  const tokenIn = slots.token_in;
  const tokenOut = slots.token_out;
  const spendToken = knownToken(state.chainId, tokenIn);
  for (const slot of template.slots) {
    const value = slots[slot.key]?.trim();
    if (!value) {
      delete slots[slot.key];
      if (slot.required) issues[slot.key] = emptyIssue(slot);
      continue;
    }
    if (slot.kind === 'amount') {
      if (!spendToken) {
        issues[slot.key] = 'Choose the token to set the amount in.';
        continue;
      }
      const parsed = parseDecimalAmount(value, spendToken.decimals);
      if ('error' in parsed) {
        issues[slot.key] = parsed.error;
        continue;
      }
      const max = amountCeiling(slot, vault?.ceiling);
      if (max !== undefined && parsed.amount > max) {
        issues[slot.key] = `Enter ${tokenAmount(max, spendToken)} or less per run.`;
        continue;
      }
      slots[slot.key] = parsed.amount.toString();
    } else if (slot.kind === 'token' || slot.kind === 'address') {
      slots[slot.key] = value;
      const message = addressIssue(value);
      if (message) issues[slot.key] = message;
    } else {
      const parsed = textToCanonical(slot, value);
      if ('error' in parsed) {
        issues[slot.key] = parsed.error;
        continue;
      }
      const numeric = BigInt(parsed.value);
      if (slot.min !== null && numeric < BigInt(slot.min)) {
        issues[slot.key] = slotBoundMessage(slot, slot.min, 'min');
        continue;
      }
      if (slot.max !== null && numeric > BigInt(slot.max)) {
        issues[slot.key] = slotBoundMessage(slot, slot.max, 'max');
        continue;
      }
      if (isExpirySlot(slot) && numeric <= BigInt(Math.floor(Date.now() / 1_000))) {
        issues[slot.key] = 'Choose an expiry in the future.';
        continue;
      }
      slots[slot.key] = parsed.value;
    }
  }

  if (vault && template.action !== 'alert') {
    if (tokenIn && tokenIn.toLowerCase() !== vault.tokenIn.toLowerCase()) {
      const expected = knownToken(state.chainId, vault.tokenIn)?.symbol ?? vault.tokenIn;
      issues.token_in = `Your vault is configured to spend ${expected}.`;
    }
    if (tokenOut && tokenOut.toLowerCase() !== vault.tokenOut.toLowerCase()) {
      const expected = knownToken(state.chainId, vault.tokenOut)?.symbol ?? vault.tokenOut;
      issues.token_out = `Your vault is configured to receive ${expected}.`;
    }
  }
  if (tokenIn && tokenOut && tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    issues.token_in ??= 'Choose different tokens for spending and receiving.';
    issues.token_out ??= 'Choose different tokens for spending and receiving.';
  }
  if (
    template.name === 'RangeAlert' &&
    slots.threshold &&
    slots.secondary &&
    !issues.threshold &&
    !issues.secondary &&
    BigInt(slots.secondary) <= BigInt(slots.threshold)
  ) {
    issues.secondary = 'Choose a high price above the low price.';
  }

  return {
    issues,
    draft: Object.keys(issues).length ? null : { ...state, slots, [READY_DRAFT]: true },
  };
}
