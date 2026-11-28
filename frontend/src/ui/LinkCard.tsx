import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

import { cx } from './classNames.js';

export function CardGrid({
  compact,
  className,
  ...props
}: HTMLAttributes<HTMLUListElement> & { readonly compact?: boolean }) {
  return (
    <ul
      {...props}
      className={cx('rb-card-grid', className)}
      data-layout={compact ? 'compact' : undefined}
    />
  );
}

export function LinkCard({
  to,
  title,
  icon,
  iconTone,
  meta,
  description,
  children,
  footer,
  cue,
}: {
  readonly to: LinkProps['to'];
  readonly title: string;
  readonly icon: ReactNode;
  readonly iconTone?: 'automation' | 'funds';
  readonly meta?: ReactNode;
  readonly description: string;
  readonly children?: ReactNode;
  readonly footer: ReactNode;
  readonly cue: string;
}) {
  return (
    <Link to={to} className="rb-card">
      <div className="rb-card-body">
        <div className="rb-card-head">
          <span className="rb-card-icon" data-role={iconTone} aria-hidden="true">
            {icon}
          </span>
          <div className="rb-card-heading">
            <h2 className="rb-card-title">{title}</h2>
            {meta ? <div className="rb-card-meta">{meta}</div> : null}
          </div>
        </div>
        <p className="rb-card-copy">{description}</p>
        {children ? <div className="rb-inline">{children}</div> : null}
      </div>
      <div className="rb-card-foot">
        {footer}
        <span className="rb-card-cue">
          {cue}
          <HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}
