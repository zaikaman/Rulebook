import type { TemplateSlot } from '@rulebook/shared';
import { createContext, useContext } from 'react';
import { useDroppable } from '@dnd-kit/core';

import { chipsForSlot, type ValueChip } from './ChipPalette.js';
import type { SlotIssues, SlotValues } from './types.js';

export interface ComposerSlotContextValue {
  readonly issues: SlotIssues;
  readonly slots: SlotValues;
  readonly setSlot: (key: TemplateSlot['key'], value: string) => void;
}

export const ComposerSlotContext = createContext<ComposerSlotContextValue | null>(null);

function useComposerSlot(): ComposerSlotContextValue {
  const value = useContext(ComposerSlotContext);
  if (!value) throw new Error('SlotChip must be rendered inside SentenceCanvas');
  return value;
}

/**
 * One blank in the sentence. It is a drop target for palette chips and a labelled native select,
 * so it is fully operable from the keyboard. An invalid value styles the chip as a failure and
 * renders the slot's own message, never a generic error.
 */
export function SlotChip({ slot }: { readonly slot: TemplateSlot }) {
  const { issues, slots, setSlot } = useComposerSlot();
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${slot.key}`,
    data: { slotKey: slot.key, kind: slot.kind },
  });
  const value = slots[slot.key] ?? '';
  const chips = chipsForSlot(slot);
  const issue = issues[slot.key];

  return (
    <span
      ref={setNodeRef}
      data-slot={slot.key}
      data-invalid={issue ? 'true' : undefined}
      className={`mx-1 inline-flex flex-col rounded-md border px-1 py-0.5 align-middle ${
        issue
          ? 'border-silent bg-silent/10'
          : isOver
            ? 'border-automation bg-automation/10'
            : 'border-border bg-surface-raised'
      }`}
    >
      <select
        aria-label={slot.label}
        aria-invalid={issue ? true : undefined}
        aria-describedby={issue ? `slot-${slot.key}-error` : undefined}
        value={value}
        onChange={(event) => setSlot(slot.key, event.target.value)}
        className="min-w-24 bg-transparent text-sm text-ink outline-none"
      >
        <option value="">[{slot.label}]</option>
        {chips.map((chip: ValueChip) => (
          <option key={chip.id} value={chip.value}>
            {chip.label}
          </option>
        ))}
      </select>
      {issue ? (
        <span id={`slot-${slot.key}-error`} role="alert" className="text-[10px] text-silent">
          {issue}
        </span>
      ) : null}
    </span>
  );
}
