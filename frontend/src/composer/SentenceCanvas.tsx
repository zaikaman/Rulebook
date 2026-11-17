import { getTemplate, type SlotKey } from '@rulebook/shared';
import { useMemo, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';

import { chipsForSlot, type ChipDragData } from './ChipPalette.js';
import { ComposerSlotContext, SlotChip } from './SlotChip.js';
import type { SlotIssues, SlotValues } from './types.js';

type SentencePart = { readonly text: string } | { readonly slotKey: string };

function splitSentence(sentence: string): SentencePart[] {
  return sentence
    .split(/(\{[a-z_]+\})/g)
    .filter((token) => token.length > 0)
    .map((token) => {
      const match = /^\{([a-z_]+)\}$/.exec(token);
      return match?.[1] ? { slotKey: match[1] } : { text: token };
    });
}

/**
 * The rule as one sentence, in trigger → condition → action order. Blanks are inline drop
 * targets; the palette and the canvas share one `DndContext`, and the keyboard sensor means
 * drag-and-drop is never the only way to build a rule.
 */
export function SentenceCanvas({
  template,
  issues,
  slots,
  setSlot,
  children,
}: {
  readonly template: number;
  readonly issues: SlotIssues;
  readonly slots: SlotValues;
  readonly setSlot: (key: SlotKey, value: string) => void;
  readonly children?: ReactNode;
}) {
  const definition = getTemplate(template);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const parts = useMemo(() => (definition ? splitSentence(definition.sentence) : []), [definition]);

  function handleDragEnd(event: DragEndEvent): void {
    const overId = event.over?.id;
    if (typeof overId !== 'string' || !overId.startsWith('slot:')) return;
    const slotKey = overId.slice('slot:'.length);
    const data = event.active.data.current as ChipDragData | undefined;
    const slot = definition?.slots.find((candidate) => candidate.key === slotKey);
    if (!data || !slot || slot.kind !== data.kind) return;
    if (!chipsForSlot(slot).some((chip) => chip.value === data.value)) return;
    setSlot(slot.key, data.value);
  }

  return (
    <ComposerSlotContext.Provider value={{ issues, slots, setSlot }}>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <p className="text-xl leading-relaxed text-ink" data-testid="composer-sentence">
          {parts.map((part, index) =>
            'text' in part ? (
              <span key={`text-${index}`}>{part.text}</span>
            ) : (
              (() => {
                const slot = definition?.slots.find((candidate) => candidate.key === part.slotKey);
                return slot ? <SlotChip key={slot.key} slot={slot} /> : null;
              })()
            ),
          )}
        </p>
        {children}
      </DndContext>
    </ComposerSlotContext.Provider>
  );
}
