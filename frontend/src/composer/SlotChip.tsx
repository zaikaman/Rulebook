import type { TemplateSlot } from '@rulebook/shared';
import { createContext, useContext, useId } from 'react';
import { useDroppable } from '@dnd-kit/core';

import { chipsForSlot, type ChipDragData } from './ChipPalette.js';
import type { SlotIssues, SlotValues } from './types.js';

export interface ComposerSlotContextValue {
  readonly issues: SlotIssues;
  readonly slots: SlotValues;
  readonly setSlot: (key: TemplateSlot['key'], value: string) => void;
  readonly presetTime: number;
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
  const { issues, slots, setSlot, presetTime } = useComposerSlot();
  const id = useId();
  const { active, setNodeRef, isOver } = useDroppable({
    id,
    data: { slotKey: slot.key, kind: slot.kind },
  });
  const value = slots[slot.key] ?? '';
  const chips = chipsForSlot(slot, presetTime);
  const issue = issues[slot.key];
  const dragged = active?.data.current as ChipDragData | undefined;
  const acceptsDrop =
    dragged?.kind === slot.kind && chips.some((chip) => chip.value === dragged.value);

  return (
    <span
      data-slot={slot.key}
      data-invalid={issue ? 'true' : undefined}
      className="rule-composer__slot"
    >
      <span
        ref={setNodeRef}
        className="rule-composer__select rule-composer__select--slot"
        data-filled={value ? 'true' : undefined}
        data-drop={acceptsDrop ? (isOver ? 'over' : 'available') : undefined}
      >
        <select
          aria-label={slot.label}
          aria-invalid={issue ? true : undefined}
          aria-describedby={issue ? `${id}-error` : undefined}
          value={value}
          onChange={(event) => setSlot(slot.key, event.target.value)}
        >
          <option value="">{slot.label}</option>
          {chips.map((chip) => (
            <option key={chip.id} value={chip.value}>
              {chip.label}
            </option>
          ))}
        </select>
      </span>
      {issue ? (
        <span id={`${id}-error`} role="alert" className="rule-composer__slot-error">
          {issue}
        </span>
      ) : null}
    </span>
  );
}
