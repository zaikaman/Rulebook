import type { HTMLAttributes } from 'react';

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
  onChange,
  disabled = false,
  className,
}: FilterGroupProps<Value>) {
  return (
    <div className={cx('rb-filter-group', className)}>
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

/** Wrapping strip that arranges multiple FilterGroup controls cleanly across breakpoints. */
export function FilterBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rb-filter-bar', className)} {...props} />;
}
