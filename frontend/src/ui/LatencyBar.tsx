import { Clock01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

import { Skeleton } from '../components/chrome/Skeleton.js';
import { cx } from './classNames.js';

export interface LatencyHop {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly role: 'automation' | 'funds' | 'neutral';
  readonly share: number;
  readonly pending?: boolean;
}

export interface LatencyBarProps {
  readonly title?: string;
  readonly totalLabel?: string | null;
  readonly totalTone?: 'active' | 'info' | 'neutral';
  readonly loading?: boolean;
  readonly hops: readonly LatencyHop[];
  readonly caption?: string | null;
  readonly className?: string;
}

/** Displays hop-by-hop cross-chain timing using Omni block timestamps. */
export function LatencyBar({
  title = 'Cross-chain timing',
  totalLabel,
  totalTone = 'neutral',
  loading = false,
  hops,
  caption,
  className,
}: LatencyBarProps) {
  return (
    <div className={cx('rb-latency', className)} role="region" aria-label={title}>
      <div className="rb-latency-head">
        <span className="rb-latency-title">
          <HugeiconsIcon icon={Clock01Icon} size={14} aria-hidden="true" />
          {title}
        </span>
        {loading && !totalLabel ? (
          <Skeleton className="rb-skeleton--chip" />
        ) : totalLabel ? (
          <span className="rb-latency-total" data-tone={totalTone}>
            {totalLabel}
          </span>
        ) : null}
      </div>

      <div className="rb-latency-track" aria-hidden="true">
        {loading ? (
          <Skeleton className="rb-skeleton--latency-track" />
        ) : (
          hops.map((hop) => (
            <span
              key={hop.id}
              className="rb-latency-segment"
              data-role={hop.role}
              data-pending={hop.pending ? 'true' : undefined}
              style={{ flexGrow: Math.max(hop.share, 0.14) }}
            />
          ))
        )}
      </div>

      <dl className="rb-latency-hops">
        {hops.map((hop) => (
          <div className="rb-latency-hop" key={hop.id}>
            <dt>
              <span
                className="rb-latency-dot"
                data-role={hop.role}
                data-pending={hop.pending ? 'true' : undefined}
                aria-hidden="true"
              />
              {hop.label}
            </dt>
            <dd data-pending={hop.pending ? 'true' : undefined}>{hop.value}</dd>
          </div>
        ))}
      </dl>

      {caption ? <p className="rb-latency-caption">{caption}</p> : null}
    </div>
  );
}
