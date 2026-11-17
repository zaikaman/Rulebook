import { getTemplate, type SlotKey } from '@rulebook/shared';

import { slotIssues } from './validation.js';
import {
  READY_DRAFT,
  type ComposerAction,
  type ComposerState,
  type ReadyDraft,
  type SlotValues,
} from './types.js';

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

/**
 * The one composer transition function. `selectTemplate` drops any slot the new template does
 * not declare, so a value can never leak from one sentence into another.
 */
export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'selectTemplate': {
      return {
        template: action.template,
        chainId: state.chainId,
        slots: pruneSlots(action.template, state.slots),
      };
    }
    case 'setSlot': {
      if (!knownKeys(state.template).includes(action.key)) return state;
      return { ...state, slots: { ...state.slots, [action.key]: action.value } };
    }
    case 'clearSlot': {
      if (!(action.key in state.slots)) return state;
      const slots = { ...state.slots };
      delete slots[action.key as SlotKey];
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
  const template = getTemplate(state.template);
  if (!template) return false;
  const missing = template.slots.filter((slot) => slot.required && !state.slots[slot.key]);
  if (missing.length > 0) return false;
  return Object.keys(slotIssues(state)).length === 0;
}

/**
 * Brands a checked draft for `encodeAddRule`. Returns null rather than throwing so the page can
 * keep showing the live sentence while the user is still choosing values.
 */
export function toReadyDraft(state: ComposerState): ReadyDraft | null {
  if (!canSign(state)) return null;
  return { ...state, [READY_DRAFT]: true } as ReadyDraft;
}
