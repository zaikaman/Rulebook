import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from 'react-router';
import type { Hex } from 'viem';

import { NetworkBadge } from '../components/NetworkBadge.js';
import { LoadingRegion, Skeleton } from '../components/chrome/Skeleton.js';
import { Badge, type BadgeTone } from './Badge.js';
import { cx } from './classNames.js';
import { ErrorState } from './ErrorState.js';
import { Panel, PanelHeader, PanelHeading } from './Panel.js';

function statusBadgeTone(status: string): BadgeTone | undefined {
  if (status === 'confirmed') return 'active';
  if (status === 'failed') return 'danger';
  if (status === 'expired' || status === 'skipped') return 'paused';
  if (status === 'pending' || status === 'in grace period') return 'info';
  return undefined;
}

export interface RunProofListItem {
  readonly id: Hex;
  readonly to: string;
  readonly originChain: number;
  readonly automationChain: number;
  readonly settlementChain: number;
  readonly path: number | null;
  readonly status: string;
  readonly latencyLabel?: string | null;
  readonly latencyLoading?: boolean;
}

export interface RunProofListProps {
  readonly items: readonly RunProofListItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly emptyMessage?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
}

function formatRunHash(hash: Hex): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** One-click list of verified cross-chain workflow runs for public proof inspection. */
export function RunProofList({
  items,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'No verified runs have been indexed on this network yet.',
  ariaLabel = 'Recent verified runs',
  className,
}: RunProofListProps) {
  if (loading) {
    return (
      <LoadingRegion
        label="Loading recent verified runs…"
        className={cx('rb-recent-runs-loading', className)}
      >
        <Skeleton className="rb-skeleton--recent-run" />
        <Skeleton className="rb-skeleton--recent-run" />
        <Skeleton className="rb-skeleton--recent-run" />
      </LoadingRegion>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  if (items.length === 0) {
    return <p className={cx('rb-recent-runs-empty', className)}>{emptyMessage}</p>;
  }

  return (
    <ul className={cx('rb-recent-runs', className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={`${item.settlementChain}:${item.id}`}>
          <Link className="rb-recent-run-row" to={item.to}>
            <div className="rb-recent-run-main">
              <div className="rb-recent-run-route">
                {item.originChain > 0 ? (
                  <NetworkBadge chainId={item.originChain} />
                ) : (
                  <span className="rb-recent-run-schedule">Internal schedule</span>
                )}
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={13}
                  aria-hidden="true"
                  className="rb-recent-run-arrow"
                />
                <NetworkBadge chainId={item.automationChain} />
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={13}
                  aria-hidden="true"
                  className="rb-recent-run-arrow"
                />
                <NetworkBadge chainId={item.settlementChain} />
              </div>

              <div className="rb-recent-run-meta">
                <Badge tone={statusBadgeTone(item.status)}>{item.status}</Badge>
                {item.path !== null ? (
                  <span className="rb-recent-run-path">Path {item.path + 1}</span>
                ) : null}
                <code className="rb-recent-run-id">{formatRunHash(item.id)}</code>
              </div>
            </div>

            <div className="rb-recent-run-aside">
              {item.latencyLabel ? (
                <span
                  className="rb-recent-run-latency"
                  data-tone={item.status === 'confirmed' ? 'active' : undefined}
                >
                  {item.latencyLabel}
                </span>
              ) : item.latencyLoading ? (
                <span className="rb-recent-run-latency" data-loading="true">
                  Timing…
                </span>
              ) : null}
              <span className="rb-recent-run-open">
                Inspect proof
                <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden="true" />
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface RunProofPanelProps extends RunProofListProps {
  readonly title: string;
  readonly description: string;
  readonly badgeLabel?: string;
  readonly titleId?: string;
}

/** Bordered panel wrapping `RunProofList` with consistent heading and badge layout. */
export function RunProofPanel({
  title,
  description,
  badgeLabel,
  titleId = 'recent-verified-runs-title',
  ...listProps
}: RunProofPanelProps) {
  return (
    <Panel role="region" className="rb-proof-recent-panel" aria-labelledby={titleId}>
      <PanelHeader>
        <PanelHeading title={title} description={description} titleId={titleId} />
        {badgeLabel ? <Badge plain>{badgeLabel}</Badge> : null}
      </PanelHeader>
      <RunProofList {...listProps} />
    </Panel>
  );
}
