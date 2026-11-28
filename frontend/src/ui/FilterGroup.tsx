import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './classNames.js';

export interface FilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly count?: number;
  readonly disabled?: boolean;
}

export interface FilterGroupProps<Value extends string> {
  readonly label: string;
  readonly showLabel?: boolean;
  readonly options: readonly FilterOption<Value>[];
  readonly value: Value;
  readonly defaultValue?: Value;
  readonly onChange: (value: Value) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** Accessible row of mutually exclusive toggle chips for filtering lists and grids. */
export function FilterGroup<Value extends string>({
  label,
  showLabel = true,
  options,
  value,
  defaultValue,
  onChange,
  disabled = false,
  className,
}: FilterGroupProps<Value>) {
  const isFiltered = defaultValue !== undefined && value !== defaultValue;

  return (
    <div
      className={cx('rb-filter-group', className)}
      data-filtered={isFiltered ? 'true' : undefined}
    >
      {showLabel ? (
        <span className="rb-filter-label" aria-hidden="true">
          {label}
        </span>
      ) : null}
      <div className="rb-filters" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="rb-filter"
            disabled={disabled || option.disabled}
            aria-pressed={value === option.value}
            data-default={
              defaultValue !== undefined && option.value === defaultValue ? 'true' : undefined
            }
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {option.count !== undefined ? (
              <span className="rb-filter-count">{option.count}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface FilterBarProps extends HTMLAttributes<HTMLDivElement> {
  readonly toolbar?: ReactNode;
}

/** Container-aware filter surface combining an optional search toolbar with grouped FilterGroup controls. */
export function FilterBar({ toolbar, className, children, ...props }: FilterBarProps) {
  return (
    <div className={cx('rb-filter-bar', className)} {...props}>
      {toolbar ? <div className="rb-filter-bar-head">{toolbar}</div> : null}
      <div className="rb-filter-bar-groups">{children}</div>
    </div>
  );
}
