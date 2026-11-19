import { ArrowDown01Icon, ArrowUp01Icon, DragDropVerticalIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
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
import { useCallback, useEffect, useRef, useState } from 'react';

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
 * back if the chain refuses it.
 */
export function RuleOrderList({ ids, labels, onReorder, disabled = false }: RuleOrderListProps) {
  const [order, setOrder] = useState<bigint[]>(() => [...ids]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirmedOrder = useRef(ids);

  // Re-sync when the chain value changes, without depending on a fresh array identity.
  const signature = ids.map((id) => id.toString()).join(',');
  useEffect(() => {
    confirmedOrder.current = ids;
    setOrder([...ids]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids is represented by signature.
  }, [signature]);

  const commit = useCallback(
    async (next: bigint[]) => {
      setOrder(next);
      setError(null);
      setPending(true);
      try {
        await onReorder(next);
      } catch (cause) {
        setOrder([...confirmedOrder.current]);
        setError(reasonFor(cause));
      } finally {
        setPending(false);
      }
    },
    [onReorder],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    if (disabled || pending || !event.over) return;
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
          <ol aria-label="Rule evaluation order" className="app-divider app-rules-list">
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
        <div role="alert" className="app-alert text-sm" data-tone="error">
          {error}
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
      className={`flex flex-wrap items-center gap-x-2 gap-y-3 bg-surface-raised py-3 text-sm ${
        isDragging ? 'relative z-10 opacity-90' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Drag rule ${label}`}
        className="app-button app-icon-button app-grab"
      >
        <HugeiconsIcon icon={DragDropVerticalIcon} size={17} aria-hidden="true" />
      </button>

      <span aria-hidden="true" className="font-mono text-xs text-ink-muted">
        {index + 1}.
      </span>
      <span className="min-w-0 flex-[1_1_10rem] break-words text-ink">{label}</span>

      {index === 0 ? <span className="app-tag">Evaluated first</span> : null}

      <span className="flex gap-1">
        <button
          type="button"
          onClick={() => onMove(index, index - 1)}
          disabled={disabled || index === 0}
          aria-label={`Move rule ${label} up`}
          title="Move up"
          className="app-button app-icon-button"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onMove(index, index + 1)}
          disabled={disabled || index === total - 1}
          aria-label={`Move rule ${label} down`}
          title="Move down"
          className="app-button app-icon-button"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={17} aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}
