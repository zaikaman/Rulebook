import { getTemplate, type SlotKey } from '@rulebook/shared';
import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';

import { ChipPalette, chipsForSlot, type ChipDragData } from './ChipPalette.js';
import { ComposerSlotContext, SlotChip } from './SlotChip.js';
import type { SlotIssues, SlotValues } from './types.js';

type SentencePart =
  | { readonly text: string }
  | { readonly slotKey: string; readonly prefix?: string; readonly suffix?: string };

function splitSentence(sentence: string): SentencePart[] {
  const parts: SentencePart[] = [];
  let end = 0;
  for (const match of sentence.matchAll(/(?:\b([a-z]+) )?\{([a-z_]+)\}([,.])?/gi)) {
    const [fragment, prefix, slotKey, suffix] = match;
    if (!slotKey) continue;
    if (match.index > end) parts.push({ text: sentence.slice(end, match.index) });
    parts.push({ slotKey, ...(prefix && { prefix }), ...(suffix && { suffix }) });
    end = match.index + fragment.length;
  }
  if (end < sentence.length) parts.push({ text: sentence.slice(end) });
  return parts;
}

const detectSlot: CollisionDetection = (args) => {
  const kind = args.active.data.current?.kind;
  const droppableContainers = args.droppableContainers.filter(
    (slot) => slot.data.current?.kind === kind,
  );
  const detect = args.pointerCoordinates ? pointerWithin : rectIntersection;
  return detect({ ...args, droppableContainers });
};

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
  const [presetTime] = useState(() => Math.floor(Date.now() / 1000));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const sentence = definition?.sentence ?? '';
  const parts = useMemo(() => splitSentence(sentence), [sentence]);

  function handleDragEnd(event: DragEndEvent): void {
    const slotKey = event.over?.data.current?.slotKey;
    const data = event.active.data.current as ChipDragData | undefined;
    const slot = definition?.slots.find((candidate) => candidate.key === slotKey);
    if (!data || !slot || slot.kind !== data.kind) return;
    if (!chipsForSlot(slot, presetTime).some((chip) => chip.value === data.value)) return;
    setSlot(slot.key, data.value);
  }

  return (
    <ComposerSlotContext.Provider value={{ issues, slots, setSlot, presetTime }}>
      <DndContext sensors={sensors} collisionDetection={detectSlot} onDragEnd={handleDragEnd}>
        <section className="rule-composer__canvas" aria-labelledby="rule-sentence-heading">
          <h2 id="rule-sentence-heading">Rule sentence</h2>
          <p className="rule-composer__sentence" data-testid="composer-sentence">
            {parts.map((part, index) => {
              if ('text' in part) return <span key={index}>{part.text}</span>;
              const slot = definition?.slots.find((candidate) => candidate.key === part.slotKey);
              if (!slot) return null;
              const prefix = slot.kind === 'schedule' && slots.schedule ? undefined : part.prefix;
              return (
                <span key={`${slot.key}-${index}`} className="rule-composer__fragment">
                  {prefix ? <span>{prefix} </span> : null}
                  <SlotChip slot={slot} />
                  {part.suffix}
                </span>
              );
            })}
          </p>
          {children}
        </section>
        <ChipPalette template={template} presetTime={presetTime} />
      </DndContext>
    </ComposerSlotContext.Provider>
  );
}
