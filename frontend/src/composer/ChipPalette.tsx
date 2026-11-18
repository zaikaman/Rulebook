import { getTemplate, type TemplateSlot } from '@rulebook/shared';
import { useDraggable } from '@dnd-kit/core';

import { DEMO_USDC, DEMO_WETH, UNICHAIN_CONFIG } from '../lib/contracts.js';

/** A palette value. `value` is always a manifest-valid string for the slot's kind. */
export interface ValueChip {
  readonly id: string;
  readonly kind: TemplateSlot['kind'];
  readonly label: string;
  readonly value: string;
}

/** Drag payload shared by the palette and the sentence canvas. */
export interface ChipDragData {
  readonly kind: TemplateSlot['kind'];
  readonly value: string;
}

const DAY = 86_400;

/**
 * Presets per slot kind. Duration is split by unit: an expiry is a unix second, an inactivity
 * period is a number of days. Every preset still passes the manifest's own min/max check.
 */
function presetsForKind(kind: TemplateSlot['kind'], unit: string | null, now: number): ValueChip[] {
  const make = (prefix: string, entries: ReadonlyArray<{ label: string; value: string }>) =>
    entries.map((entry, index) => ({ id: `${prefix}-${index}`, kind, ...entry }));

  switch (kind) {
    case 'schedule':
      return make('schedule', [
        { label: 'every hour', value: '3600' },
        { label: 'every day', value: '86400' },
        { label: 'every week', value: '604800' },
      ]);
    case 'amount':
      return make('amount', [
        { label: '10', value: '10000000' },
        { label: '25', value: '25000000' },
        { label: '100', value: '100000000' },
      ]);
    case 'token':
      return make('token', [
        { label: 'USDC', value: DEMO_USDC },
        { label: 'WETH', value: DEMO_WETH },
      ]);
    case 'price':
      return make('price', [
        { label: '2,000', value: '2000000000000000000000' },
        { label: '2,500', value: '2500000000000000000000' },
        { label: '3,000', value: '3000000000000000000000' },
      ]);
    case 'percent':
      return make('percent', [
        { label: '1%', value: '100' },
        { label: '5%', value: '500' },
        { label: '10%', value: '1000' },
      ]);
    case 'duration':
      return unit === 'unix seconds'
        ? make('expiry', [
            { label: 'in 30 days', value: String(now + 30 * DAY) },
            { label: 'in 90 days', value: String(now + 90 * DAY) },
            { label: 'in 365 days', value: String(now + 365 * DAY) },
          ])
        : make('inactivity', [
            { label: '30 days', value: '30' },
            { label: '90 days', value: '90' },
            { label: '180 days', value: '180' },
          ]);
    case 'address':
      return make('address', [
        { label: 'price pair', value: UNICHAIN_CONFIG.pair },
        { label: 'my wallet', value: '0x1111111111111111111111111111111111111111' },
      ]);
    default:
      return [];
  }
}

/** The chips that may fill one specific slot, derived from the manifest's kind and unit. */
export function chipsForSlot(slot: TemplateSlot, presetTime: number): readonly ValueChip[] {
  return presetsForKind(slot.kind, slot.unit, presetTime);
}

/** Slot definitions grouped by the kind of value they accept, for the chosen template. */
function slotsByKind(template: number): Map<TemplateSlot['kind'], TemplateSlot[]> {
  const grouped = new Map<TemplateSlot['kind'], TemplateSlot[]>();
  for (const slot of getTemplate(template)?.slots ?? []) {
    const list = grouped.get(slot.kind) ?? [];
    list.push(slot);
    grouped.set(slot.kind, list);
  }
  return grouped;
}

function DraggableChip({ chip }: { readonly chip: ValueChip }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `chip:${chip.id}`,
    data: { kind: chip.kind, value: chip.value } satisfies ChipDragData,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className="rule-composer__preset"
      data-dragging={isDragging ? 'true' : undefined}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
    >
      {chip.label}
    </button>
  );
}

/**
 * Value chips grouped by slot kind. A chip is draggable onto a blank in the sentence; the same
 * values are offered as a native select inside each blank for keyboard users.
 */
const KIND_LABEL: Record<TemplateSlot['kind'], string> = {
  schedule: 'Schedule',
  amount: 'Amount',
  token: 'Token',
  price: 'Price',
  percent: 'Percentage',
  duration: 'Duration',
  address: 'Address',
};

export function ChipPalette({
  template,
  presetTime,
}: {
  readonly template: number;
  readonly presetTime: number;
}) {
  const grouped = slotsByKind(template);
  return (
    <section aria-labelledby="rule-values-heading" className="rule-composer__presets">
      <h2 id="rule-values-heading">Preset values</h2>
      <p>Drag a value into the sentence, or choose it from a blank’s menu.</p>
      <div className="rule-composer__preset-list">
        {[...grouped.entries()].map(([kind, [slot, ...otherSlots]]) => {
          if (!slot) return null;
          const chips = chipsForSlot(slot, presetTime);
          if (chips.length === 0) return null;
          return (
            <div key={kind} className="rule-composer__preset-row">
              <h3>
                {KIND_LABEL[kind]}
                {otherSlots.length > 0 ? (
                  <small>{[slot, ...otherSlots].map((entry) => entry.label).join(' · ')}</small>
                ) : null}
              </h3>
              <div className="rule-composer__preset-chips">
                {chips.map((chip) => (
                  <DraggableChip key={chip.id} chip={chip} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
