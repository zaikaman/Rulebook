import type { HTMLAttributes } from 'react';

import { cx } from './classNames.js';

export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rb-toolbar', className)} {...props} />;
}
