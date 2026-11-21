import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './classNames.js';

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('app-panel', className)} {...props} />;
}

export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rb-panel-head', className)} {...props} />;
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rb-panel-body', className)} {...props} />;
}

export function PanelTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cx('rb-panel-title', className)} {...props} />;
}

export function PanelCopy({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx('rb-panel-copy', className)} {...props} />;
}

export function PanelHeading({
  title,
  description,
  titleId,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly titleId?: string;
}) {
  return (
    <div>
      <PanelTitle id={titleId}>{title}</PanelTitle>
      {description ? <PanelCopy>{description}</PanelCopy> : null}
    </div>
  );
}
