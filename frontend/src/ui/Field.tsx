import { useId, type ReactNode } from 'react';

import { cx } from './classNames.js';

export interface FieldIds {
  readonly hint?: string;
  readonly error?: string;
}

export interface FieldProps {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  /**
   * Either the control itself, or a function that receives the ids of the rendered hint and
   * error so the control can set `aria-describedby`.
   */
  readonly children: ReactNode | ((ids: FieldIds) => ReactNode);
  readonly className?: string;
}

/**
 * The label wraps its control, so no generated id or `htmlFor` is required. Keep the native
 * control accessible name from the visible label; do not repeat it in `aria-label`.
 */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cx('app-field', className)}>
      <label className="app-field__control">
        {label}
        {typeof children === 'function' ? children({ hint: hintId, error: errorId }) : children}
      </label>
      {hint ? (
        <span id={hintId} className="rb-field-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="rb-field-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
