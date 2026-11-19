import { getTemplate } from '@rulebook/shared';

import { validateComposer } from './validation.js';
import type { ComposerAction, ComposerState, SlotValues } from './types.js';

/** Starts a composer with no values; the picker chooses the first template. */
export function initialComposerState(
  chainId: number,
  template: ComposerState['template'] = 1,
): ComposerState {
  return { template, chainId, slots: {} };
}

function knownKeys(template: number): readonly string[] {
  return getTemplate(template)?.slots.map((slot) => slot.key) ?? [];
}

function pruneSlots(template: number, slots: SlotValues): SlotValues {
  const known = new Set(knownKeys(template));
  return Object.fromEntries(Object.entries(slots).filter(([key]) => known.has(key))) as SlotValues;
}

function clearAmounts(state: ComposerState, slots: SlotValues): void {
  for (const slot of getTemplate(state.template)?.slots ?? []) {
    if (slot.kind === 'amount') delete slots[slot.key];
  }
}

/**
 * The one composer transition function. `selectTemplate` drops any slot the new template does
 * not declare, so a value can never leak from one sentence into another.
 */
export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'selectTemplate': {
      if (action.template === state.template) return state;
      const slots = pruneSlots(action.template, state.slots);
      const previous = getTemplate(state.template);
      for (const slot of getTemplate(action.template)?.slots ?? []) {
        if (!previous?.slots.some((old) => old.key === slot.key && old.unit === slot.unit)) {
          delete slots[slot.key];
        }
      }
      return {
        template: action.template,
        chainId: state.chainId,
        slots,
      };
    }
    case 'setSlot': {
      if (!knownKeys(state.template).includes(action.key)) return state;
      const slots = { ...state.slots, [action.key]: action.value };
      if (
        action.key === 'token_in' &&
        state.slots.token_in &&
        state.slots.token_in.toLowerCase() !== action.value.toLowerCase()
      ) {
        clearAmounts(state, slots);
      }
      return { ...state, slots };
    }
    case 'clearSlot': {
      if (!(action.key in state.slots)) return state;
      const slots = { ...state.slots };
      delete slots[action.key];
      if (action.key === 'token_in') clearAmounts(state, slots);
      return { ...state, slots };
    }
    case 'reset': {
      return { ...state, slots: {} };
    }
    default:
      return state;
  }
}

/** True when no slot is missing, invalid, or conflicting. */
export function canSign(state: ComposerState): boolean {
  return validateComposer(state).draft !== null;
}
