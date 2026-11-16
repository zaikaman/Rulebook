import type { SlotKey, TemplateId } from '@rulebook/shared';

/** One value per slot key; a missing key is an unfilled slot. */
export type SlotValues = Partial<Record<SlotKey, string>>;

/** The composer's whole state: one template, one chain, and the values chosen so far. */
export interface ComposerState {
  readonly template: TemplateId;
  readonly chainId: number;
  readonly slots: SlotValues;
}

export type ComposerAction =
  | { readonly type: 'selectTemplate'; readonly template: TemplateId }
  | { readonly type: 'setSlot'; readonly key: SlotKey; readonly value: string }
  | { readonly type: 'clearSlot'; readonly key: SlotKey }
  | { readonly type: 'reset' };

export const READY_DRAFT: unique symbol = Symbol('rulebook.ready-draft');

/**
 * A draft that passed `canSign`. The brand is unforgeable outside this module, so an encoder
 * that takes a `ReadyDraft` cannot be handed an incomplete money rule.
 */
export type ReadyDraft = {
  readonly template: TemplateId;
  readonly chainId: number;
  readonly slots: SlotValues;
  readonly [READY_DRAFT]: true;
};

/** A slot problem, keyed by slot so the UI can highlight the exact chip. */
export type SlotIssues = Readonly<Record<string, string>>;
