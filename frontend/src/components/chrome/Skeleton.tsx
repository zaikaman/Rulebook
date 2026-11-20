import type { ReactNode } from 'react';

/** One shimmering placeholder bone. Decorative: a `LoadingRegion` names what is loading. */
export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div aria-hidden="true" className={className ? `rb-skeleton ${className}` : 'rb-skeleton'} />
  );
}

/**
 * Groups placeholder shapes under one announced status. The shapes stay hidden from assistive
 * technology so a screen reader hears the label once instead of reading a dozen empty boxes.
 */
export function LoadingRegion({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div aria-busy="true" className={className}>
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Metrics row placeholder shaped like `.rb-metric`. */
export function MetricsSkeleton({ count = 3 }: { readonly count?: number }) {
  return (
    <div aria-hidden="true" className="rb-metrics">
      {Array.from({ length: count }, (_, index) => (
        <div className="rb-metric" key={index}>
          <Skeleton className="rb-skeleton--line rb-skeleton--short" />
          <Skeleton className="rb-skeleton--metric-value" />
          <Skeleton className="rb-skeleton--line rb-skeleton--medium" />
        </div>
      ))}
    </div>
  );
}

/** Card grid placeholder shaped like `.rb-card`, including its header and footer rhythm. */
export function CardGridSkeleton({ count = 3 }: { readonly count?: number }) {
  return (
    <div aria-hidden="true" className="rb-skeleton-grid">
      {Array.from({ length: count }, (_, index) => (
        <div className="rb-card-skeleton" key={index}>
          <div className="rb-card-skeleton-head">
            <Skeleton className="rb-skeleton--icon" />
            <div className="rb-card-skeleton-copy">
              <Skeleton className="rb-skeleton--title" />
              <Skeleton className="rb-skeleton--line rb-skeleton--short" />
            </div>
          </div>
          <div className="rb-card-skeleton-body">
            <Skeleton className="rb-skeleton--line" />
            <Skeleton className="rb-skeleton--line rb-skeleton--medium" />
          </div>
          <div className="rb-card-skeleton-foot">
            <Skeleton className="rb-skeleton--line rb-skeleton--short" />
            <Skeleton className="rb-skeleton--line rb-skeleton--link" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Feed placeholder shaped like the activity list's `.rb-run` rows. */
export function FeedSkeleton({ count = 3 }: { readonly count?: number }) {
  return (
    <div aria-hidden="true" className="rb-feed">
      {Array.from({ length: count }, (_, index) => (
        <div className="rb-run" key={index}>
          <Skeleton className="rb-skeleton--run-marker" />
          <div className="rb-run-body">
            <div className="rb-run-head">
              <Skeleton className="rb-skeleton--title" />
              <Skeleton className="rb-skeleton--chip" />
            </div>
            <Skeleton className="rb-skeleton--line rb-skeleton--medium" />
            <div className="rb-run-links">
              <Skeleton className="rb-skeleton--line rb-skeleton--link" />
              <Skeleton className="rb-skeleton--line rb-skeleton--link" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stacked panel rows for lists, tables, and record sections that are still being read. */
export function PanelSkeleton({
  rows = 3,
  rowClassName = 'rb-skeleton--row',
}: {
  readonly rows?: number;
  readonly rowClassName?: string;
}) {
  return (
    <div aria-hidden="true" className="rb-panel-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton className={rowClassName} key={index} />
      ))}
    </div>
  );
}
