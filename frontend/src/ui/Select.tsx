import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { cx } from './classNames.js';

export interface SelectOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

export interface SelectGroup<Value extends string> {
  readonly label: string;
  readonly options: readonly SelectOption<Value>[];
}

export interface SelectProps<Value extends string> {
  readonly value: Value;
  /** Option values must be unique across every group. */
  readonly groups: readonly SelectGroup<Value>[];
  readonly onChange: (value: Value) => void;
  readonly className?: string;
  readonly 'aria-describedby'?: string;
}

/**
 * A grouped single-choice control that renders its options inside the workspace instead of the
 * operating system's option window, which ignores the design system and clips at the viewport.
 * Focus stays on the trigger; the active option is announced with `aria-activedescendant`.
 */
export function Select<Value extends string>({
  value,
  groups,
  onChange,
  className,
  'aria-describedby': describedBy,
}: SelectProps<Value>) {
  const id = useId();
  const listId = `${id}-list`;
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'below' | 'above'>('below');
  const flat = useMemo(
    () =>
      groups.flatMap((group) =>
        group.options.map((option, index) => ({ option, id: `${id}-${group.label}-${index}` })),
      ),
    [groups, id],
  );
  const selectedIndex = Math.max(
    0,
    flat.findIndex((row) => row.option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = flat.find((row) => row.option.value === value) ?? flat[0];
  const active = flat[activeIndex];

  function show() {
    setActiveIndex(selectedIndex);
    const element = trigger.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      setPlacement(window.innerHeight - rect.bottom < 240 && rect.top > 240 ? 'above' : 'below');
    }
    setOpen(true);
  }

  function choose(index: number) {
    const row = flat[index];
    if (!row) return;
    onChange(row.option.value);
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open || !active) return;
    document.getElementById(active.id)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();
        show();
      }
      return;
    }
    const last = flat.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(last, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(last);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapper} className={cx('app-select', className)}>
      <button
        ref={trigger}
        type="button"
        className="app-select__trigger"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? active?.id : undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className="app-select__value">{selected?.option.label}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open ? (
        <div className="app-select__list" id={listId} role="listbox" data-placement={placement}>
          {groups.map((group) => (
            <div
              className="app-select__group"
              role="group"
              aria-label={group.label}
              key={group.label}
            >
              <p className="app-select__group-label" aria-hidden="true">
                {group.label}
              </p>
              {group.options.map((option) => {
                const index = flat.findIndex((row) => row.option.value === option.value);
                return (
                  <div
                    key={option.value}
                    id={flat[index]?.id}
                    role="option"
                    aria-selected={option.value === value}
                    data-active={index === activeIndex}
                    className="app-select__option"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                  >
                    {option.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
