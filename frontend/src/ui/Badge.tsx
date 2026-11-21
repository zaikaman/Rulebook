import type { HTMLAttributes } from 'react';

import { cx } from './classNames.js';

export type BadgeTone = 'active' | 'paused' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
  readonly plain?: boolean;
}

export function Badge({ tone, plain = false, className, ...props }: BadgeProps) {
  return (
    <span
      className={cx('rb-chip', plain && 'rb-chip--plain', className)}
      data-tone={tone}
      {...props}
    />
  );
}
