import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useCallback, useEffect, useState } from 'react';

import { describeError } from '../lib/errors.js';

export interface RuleOrderListProps {
  /** Current evaluation order, as stored by the Agent. */
  readonly ids: readonly bigint[];
  /** Optional sentence or label per rule id, keyed by `id.toString()`. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Persists a new full permutation; rejects when the chain refuses the reorder. */
  readonly onReorder: (ids: bigint[]) => Promise<unknown>;
  readonly disabled?: boolean;
}

function reasonFor(error: unknown): string {
  const known = describeError(error);
  if (known) return known.message;
  return error instanceof Error ? error.message : 'The new order was not saved.';
}

/**
 * The Agent evaluates rules top to bottom. This list is that order: a drop or a keyboard move
 * submits the complete permutation, shows the new order immediately, and rolls the visual order
 * back if the chain refuses it. The first row is explicitly labelled "Runs first" rather than
 * leaving the reader to infer that position matters.
 */
export function RuleOrderList({ ids, labels, onReorder, disabled = false }: RuleOrderListProps) {
  const [order, setOrder] = useState<bigint[]>(() => [...ids]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Re-sync when the chain value changes, without depending on a fresh array identity.
  const signature = ids.map((id) => id.toString()).join(',');
  useEffect(() => {
    setOrder([...ids]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids is represented by signature.
  }, [signature]);

  const commit = useCallback(
    async (next: bigint[]) => {
      const previous = order;
      setOrder(next);
      setError(null);
      setPending(true);
      try {
        await onReorder(next);
      } catch (cause) {
        setOrder(previous);
        setError(reasonFor(cause));
      } finally {
        setPending(false);
      }
    },
    [onReorder, order],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    if (disabled || !event.over) return;
    const oldIndex = order.findIndex((id) => id.toString() === String(event.active.id));
    const newIndex = order.findIndex((id) => id.toString() === String(event.over?.id));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    void commit(arrayMove(order, oldIndex, newIndex));
  }

  const labelFor = (id: bigint): string => labels?.[id.toString()] ?? `#${id.toString()}`;

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={order.map((id) => id.toString())}
          strategy={verticalListSortingStrategy}
        >
          <ol aria-label="Rule evaluation order" className="space-y-2">
            {order.map((id, index) => (
              <SortableRule
                key={id.toString()}
                id={id}
                index={index}
                total={order.length}
                label={labelFor(id)}
                disabled={disabled || pending}
                onMove={(from, to) => void commit(arrayMove(order, from, to))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-cancelled/40 bg-cancelled/10 p-3 text-xs text-ink"
        >
          {error} The previous order is still in effect.
        </div>
      ) : null}
    </div>
  );
}

function SortableRule({
  id,
  index,
  total,
  label,
  disabled,
  onMove,
}: {
  readonly id: bigint;
  readonly index: number;
  readonly total: number;
  readonly label: string;
  readonly disabled: boolean;
  readonly onMove: (from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: id.toString(),
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      data-testid={`rule-order-${id.toString()}`}
      data-position={index}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
              transition,
            }
          : transition
            ? { transition }
            : undefined
      }
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-3 text-sm ${
        isDragging ? 'opacity-70' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Drag rule ${label}`}
        className="cursor-grab text-ink-muted disabled:cursor-not-allowed"
      >
        ⠿
      </button>

      <span aria-hidden="true" className="font-mono text-xs text-ink-muted">
        {index + 1}.
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{label}</span>

      {index === 0 ? (
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
          Runs first
        </span>
      ) : null}

      <span className="flex gap-1">
        <button
          type="button"
          onClick={() => onMove(index, index - 1)}
          disabled={disabled || index === 0}
          aria-label={`Move rule ${label} up`}
          className="rounded-full border border-border px-2 py-0.5 text-xs text-ink disabled:opacity-40"
        >
          Move up
        </button>
        <button
          type="button"
          onClick={() => onMove(index, index + 1)}
          disabled={disabled || index === total - 1}
          aria-label={`Move rule ${label} down`}
          className="rounded-full border border-border px-2 py-0.5 text-xs text-ink disabled:opacity-40"
        >
          Move down
        </button>
      </span>
    </li>
  );
}
