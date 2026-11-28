import type { ReactNode } from 'react';

import { Badge, type BadgeTone } from './Badge.js';
import { cx } from './classNames.js';

export type RunwayReadoutTone = 'default' | 'active' | 'paused' | 'danger' | 'muted';

export interface RunwayReadoutBadge {
  readonly label: string;
  readonly tone?: BadgeTone;
  readonly plain?: boolean;
}

export interface RunwayReadoutProps {
  readonly label?: string;
  readonly value: string;
  readonly detail?: ReactNode;
  readonly badge?: RunwayReadoutBadge;
  readonly tone?: RunwayReadoutTone;
  readonly size?: 'featured' | 'compact';
  readonly className?: string;
}

/** Translates live gas and credit reserves into a scannable run-count estimate. */
export function RunwayReadout({
  label = 'Estimated runway',
  value,
  detail,
  badge,
  tone = 'default',
  size = 'featured',
  className,
}: RunwayReadoutProps) {
  return (
    <div className={cx('rb-runway', className)} data-size={size} data-tone={tone}>
      <div className="rb-runway-head">
        <span className="rb-runway-label">{label}</span>
        {badge ? (
          <Badge tone={badge.tone} plain={badge.plain}>
            {badge.label}
          </Badge>
        ) : null}
      </div>
      <p className="rb-runway-value">{value}</p>
      {detail ? <p className="rb-runway-detail">{detail}</p> : null}
    </div>
  );
}
