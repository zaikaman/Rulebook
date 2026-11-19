import type { SlotKey, TemplateId } from '@rulebook/shared';

/** One value per slot key; a missing key is an unfilled slot. */
export type SlotValues = Partial<Record<SlotKey, string>>;

export interface VaultTerms {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly ceiling: bigint;
}

/** Amount fields hold the user's decimal text until validation converts it to base units. */
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
 * A checked draft. All numeric slots contain whole numbers in their respective on-chain units.
 */
export type ReadyDraft = {
  readonly template: TemplateId;
  readonly chainId: number;
  readonly slots: SlotValues;
  readonly [READY_DRAFT]: true;
};

/** A slot problem, keyed by slot so the UI can highlight the exact chip. */
export type SlotIssues = Readonly<Record<string, string>>;
