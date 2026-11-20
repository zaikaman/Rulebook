import { Activity01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useAccount } from 'wagmi';

import { EmptyState } from '@/components/chrome/EmptyState';
import { PageHeading } from '@/components/chrome/PageHeading';
import { WalletControl } from '@/components/chrome/WalletControl';
import { appRoutes } from '@/lib/routes';
import { workflowApi } from './api';

export function WorkflowActivity() {
  const { address, isConnecting, isReconnecting } = useAccount();
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') === 'attention' ? 'attention' : 'all';
  const query = useInfiniteQuery({
    queryKey: ['workflow-activity', address, filter],
    enabled: Boolean(address),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      workflowApi.activity(
        new URLSearchParams({
          owner: address!,
          filter,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (state) => (state.state.data?.pages.length === 1 ? 15_000 : false),
  });
  const runs = query.data?.pages.flatMap((page) => page.runs) ?? [];

  return (
    <section className="app-page workflow-page">
      <PageHeading title="Activity" description="See what ran while you were away." />
      {!address &&
        (isConnecting || isReconnecting ? (
          <p role="status">Connecting wallet…</p>
        ) : (
          <EmptyState
            icon={Activity01Icon}
            title="Connect your wallet to see activity"
            description="Check runs and open their on-chain proofs for this wallet."
            action={<WalletControl setup />}
          />
        ))}
      {address && (
        <>
          <div className="workflow-activity-controls">
            <label htmlFor="workflow-activity-filter">Show runs</label>
            <select
              id="workflow-activity-filter"
              className="app-input"
              value={filter}
              onChange={(event) =>
                setParams(event.target.value === 'attention' ? { filter: 'attention' } : {}, {
                  replace: true,
                })
              }
            >
              <option value="all">All statuses</option>
              <option value="attention">Needs attention</option>
            </select>
          </div>
          {query.isPending && <p role="status">Loading workflow runs…</p>}
          {query.isError && (
            <div className="workflow-feedback" role="alert">
              <p>Couldn’t load workflow runs. Try again in a moment.</p>
              {!query.isFetchNextPageError && (
                <button type="button" className="app-button" onClick={() => void query.refetch()}>
                  Try again
                </button>
              )}
            </div>
          )}
          {query.isSuccess && runs.length === 0 && (
            <EmptyState
              icon={Activity01Icon}
              title={filter === 'attention' ? 'No runs need attention' : 'No runs yet'}
              description={
                filter === 'attention'
                  ? 'Failed and unconfirmed runs will appear here.'
                  : 'Runs appear here after a workflow detects a matching event.'
              }
              action={
                filter === 'all' ? (
                  <Link className="app-button" to={appRoutes.workflows}>
                    Go to workflows
                  </Link>
                ) : undefined
              }
            />
          )}
          {runs.length > 0 && (
            <ul
              className="app-panel workflow-activity-list"
              aria-label="Workflow runs, newest first"
            >
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    className="workflow-workspace-row workflow-activity-row"
                    to={appRoutes.runs + '/' + run.id}
                    state={filter === 'attention' ? { activityFilter: filter } : undefined}
                  >
                    <span className="workflow-activity-details">
                      <strong>{run.title || `Workflow ${run.workflowId.slice(0, 10)}`}</strong>
                      <span
                        className="workflow-activity-status"
                        data-attention={
                          run.status === 'Failed' ||
                          run.status === 'No result confirmed' ||
                          undefined
                        }
                      >
                        {run.status}
                        <span className="workflow-activity-id"> · Run {run.id.slice(0, 10)}</span>
                      </span>
                    </span>
                    <span className="workflow-activity-proof">
                      View proof{' '}
                      <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {query.hasNextPage && (
            <div className="workflow-actions">
              <button
                className="app-button"
                type="button"
                disabled={query.isFetching}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage
                  ? 'Loading more runs…'
                  : query.isFetchNextPageError
                    ? 'Retry loading more runs'
                    : 'Load more runs'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
