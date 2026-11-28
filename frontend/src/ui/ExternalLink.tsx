import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { cx } from './classNames.js';

export interface ExternalLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'target' | 'rel'
> {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: 'link' | 'button';
}

/** Accessible external link with an outbound arrow icon and screen-reader new-tab notice. */
export function ExternalLink({
  href,
  children,
  variant = 'link',
  className,
  ...props
}: ExternalLinkProps) {
  return (
    <a
      className={cx(
        variant === 'button' ? 'app-button' : 'app-link',
        'rb-external-link',
        className,
      )}
      href={href}
      target="_blank"
      rel="noreferrer"
      {...props}
    >
      {children}
      <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
