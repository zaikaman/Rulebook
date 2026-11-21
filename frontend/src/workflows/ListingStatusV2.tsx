import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router';

import { ErrorState } from '@/components/ErrorState';
import { PageHeading } from '@/components/chrome/PageHeading';
import { LoadingRegion, Skeleton } from '@/components/chrome/Skeleton';
import { ListingReadError } from './listingV2';

export function ListingStatusV2({
  query,
  copying = false,
}: {
  query: UseQueryResult<unknown>;
  copying?: boolean;
}) {
  const syncing =
    query.failureReason instanceof ListingReadError && query.failureReason.kind === 'syncing';
  const checkAgain = () => void query.refetch({ cancelRefetch: false });
  let loading = copying ? 'Preparing your copy…' : 'Reading the published workflow…';
  if (query.isPaused) loading = 'Waiting for a connection…';
  else if (query.failureReason) loading = 'Retrying the Marketplace request…';

  const status = query.isPaused
    ? 'Checking will resume when you reconnect.'
    : query.isError
      ? 'The Marketplace is taking longer than usual to sync it.'
      : 'This page will update when it appears in the Marketplace.';

  return (
    <section className="app-page">
      <PageHeading
        title={copying ? 'Copy workflow' : 'Listing details'}
        aside={
          <Link className="app-button" to="/marketplace">
            Back to Marketplace
          </Link>
        }
      />
      {syncing ? (
        <div className="app-panel rb-sync">
          <header className="rb-panel-head">
            <div className="rb-sync-heading" role="status">
              <span className="rb-sync-mark" aria-hidden="true">
                <span className="rb-sync-pulse" />
              </span>
              <div>
                <h2 className="rb-panel-title">Syncing listing</h2>
                <p className="rb-panel-copy">This workflow is public on Reactive Lasna. {status}</p>
              </div>
            </div>
            <span className="rb-chip" data-tone="info">
              Indexing
            </span>
          </header>
          <div className="rb-panel-body rb-sync-body">
            <div className="rb-sync-track" aria-hidden="true">
              <span />
            </div>
            <p className="rb-sync-note">
              The indexer checks for confirmed blocks every few seconds. You can leave this page
              open or return to the Marketplace.
            </p>
            {query.isError && (
              <div className="rb-sync-actions">
                <button type="button" className="app-button" onClick={checkAgain}>
                  Check again
                </button>
              </div>
            )}
          </div>
        </div>
      ) : query.error && !query.isFetching ? (
        <ErrorState
          message={
            query.error instanceof ListingReadError
              ? query.error.message
              : 'The Marketplace could not load this listing.'
          }
          onRetry={checkAgain}
        />
      ) : (
        <LoadingRegion label={loading} className="rb-page-skeleton">
          <div className="rb-page-skeleton-toolbar">
            <Skeleton className="rb-skeleton--line rb-skeleton--short" />
            <Skeleton className="rb-skeleton--chip" />
          </div>
          <div className="rb-split">
            <Skeleton className="rb-skeleton--canvas" />
            <Skeleton className="rb-skeleton--panel" />
          </div>
        </LoadingRegion>
      )}
    </section>
  );
}
