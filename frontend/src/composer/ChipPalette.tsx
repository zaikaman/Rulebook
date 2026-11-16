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
function presetsForKind(kind: TemplateSlot['kind'], unit: string | null): ValueChip[] {
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
    case 'duration': {
      const now = Math.floor(Date.now() / 1000);
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
    }
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
export function chipsForSlot(slot: TemplateSlot): readonly ValueChip[] {
  return presetsForKind(slot.kind, slot.unit);
}

/** Slot definitions grouped by the kind of value they accept, for the chosen template. */
export function slotsByKind(template: number): Map<TemplateSlot['kind'], TemplateSlot[]> {
  const grouped = new Map<TemplateSlot['kind'], TemplateSlot[]>();
  for (const slot of getTemplate(template)?.slots ?? []) {
    const list = grouped.get(slot.kind) ?? [];
    list.push(slot);
    grouped.set(slot.kind, list);
  }
  return grouped;
}

function DraggableChip({ chip }: { readonly chip: ValueChip }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip:${chip.id}`,
    data: { kind: chip.kind, value: chip.value } satisfies ChipDragData,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={`rounded-full border border-border bg-surface-raised px-3 py-1 text-xs text-ink hover:border-automation ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      {chip.label}
    </button>
  );
}

/**
 * Value chips grouped by slot kind. A chip is draggable onto a blank in the sentence; the same
 * values are offered as a native select inside each blank for keyboard users.
 */
export function ChipPalette({ template }: { readonly template: number }) {
  const grouped = slotsByKind(template);
  return (
    <section aria-label="Value chips" className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium text-ink">Values</h2>
      <p className="text-xs text-ink-muted">
        Drag a chip onto a blank, or focus a blank and choose a value. There is no text field.
      </p>
      {[...grouped.entries()].map(([kind, slots]) => {
        const chips = chipsForSlot(slots[0]!);
        if (chips.length === 0) return null;
        return (
          <div key={kind} className="space-y-1">
            <h3 className="text-xs uppercase tracking-wide text-ink-muted">
              {kind} — {slots.map((slot) => slot.label).join(', ')}
            </h3>
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <DraggableChip key={chip.id} chip={chip} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
