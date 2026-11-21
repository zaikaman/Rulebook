import type { ReactNode } from 'react';

import { cx } from './classNames.js';

export interface FieldProps {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The label wraps its control, so no generated id or `htmlFor` is required. Keep the native
 * control accessible name from the visible label; do not repeat it in `aria-label`.
 */
export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <label className={cx('app-field', className)}>
      {label}
      {children}
      {hint ? <span className="rb-field-hint">{hint}</span> : null}
      {error ? <span className="rb-field-error">{error}</span> : null}
    </label>
  );
}
