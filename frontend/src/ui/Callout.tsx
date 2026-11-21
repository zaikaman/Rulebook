import type { ReactNode } from 'react';

import { cx } from './classNames.js';

export interface CalloutProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly tone?: 'default' | 'recovery';
  readonly className?: string;
}

/** A bordered prompt with one explanation and one action, never a bare utility row. */
export function Callout({ title, children, action, tone = 'default', className }: CalloutProps) {
  return (
    <div className={cx('rb-callout', tone === 'recovery' && 'rb-callout--recovery', className)}>
      <div className="rb-callout-copy">
        <p className="rb-callout-title">{title}</p>
        {children}
      </div>
      {action}
    </div>
  );
}
