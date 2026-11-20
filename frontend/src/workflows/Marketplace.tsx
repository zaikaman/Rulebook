import {
  decodeWorkflow,
  getChain,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowTriggerLabels,
  workflowTriggers,
} from '@rulebook/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeading } from '@/components/chrome/PageHeading';
import { LoadingRegion, PanelSkeleton, Skeleton } from '@/components/chrome/Skeleton';
import { Spinner } from '@/components/chrome/Spinner';
import { AddressLink } from '@/components/AddressLink';
import { Field } from './Builder';
import { WorkflowGraph, WorkflowOutline } from './Graph';
import { verifyListing } from './listing';
import { workflowApi } from './api';

const MARKET_TAGS = ['Payments', 'Prices', 'Schedules', 'Transfers', 'Swaps', 'Alerts'];
const chain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);

export function WorkflowMarketplace() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const tag = params.get('tag') ?? '';
  const rawTrigger = params.get('trigger');
  const trigger = workflowTriggers.find((item) => item === rawTrigger) ?? '';
  const rawSort = params.get('sort');
  const sort = rawSort === 'newest' || rawSort === 'runs' ? rawSort : 'popular';
  const query = useInfiniteQuery({
    queryKey: ['workflow-market', search, tag, trigger, sort],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      workflowApi.marketplace(
        new URLSearchParams({
          q: search,
          tag,
          trigger,
          sort,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
  const listings = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.listings).map((item) => [item.id, item]),
    ).values(),
  ];

  function filter(key: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <section className="app-page workflow-page">
      <PageHeading
        title="Workflow Marketplace"
        description="Find a workflow, see how it works, and make it your own."
      />
      <div className="workflow-market-filters">
        <Field label="Search workflows">
          <input
            className="app-input"
            type="search"
            maxLength={160}
            placeholder="Search by name or description"
            value={search}
            onChange={(event) => filter('q', event.target.value)}
          />
        </Field>
        <Field label="Tag">
          <select
            className="app-input"
            value={tag}
            onChange={(event) => filter('tag', event.target.value)}
          >
            <option value="">All tags</option>
            {MARKET_TAGS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Trigger">
          <select
            className="app-input"
            value={trigger}
            onChange={(event) => filter('trigger', event.target.value)}
          >
            <option value="">All triggers</option>
            {workflowTriggers.map((item) => (
              <option key={item} value={item}>
                {workflowTriggerLabels[item]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sort by">
          <select
            className="app-input"
            value={sort}
            onChange={(event) => filter('sort', event.target.value)}
          >
            <option value="popular">Popular</option>
            <option value="newest">Newest</option>
            <option value="runs">Most runs</option>
          </select>
        </Field>
      </div>
      {query.isPending ? (
        <LoadingRegion label="Loading public workflows…">
          <PanelSkeleton rows={4} rowClassName="rb-skeleton--table-row" />
        </LoadingRegion>
      ) : null}
      {query.isError ? (
        <div className="workflow-feedback" role="alert">
          <p>{query.error.message}</p>
          <button type="button" className="app-button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {!query.isPending && !query.isError && listings.length === 0 && (
        <div className="app-panel app-panel-pad">
          <h2 className="app-panel-heading">
            {search || tag || trigger
              ? 'No matching workflows'
              : 'No workflows have been published yet'}
          </h2>
          {search || tag || trigger ? (
            <button type="button" className="app-button" onClick={() => setParams({})}>
              Clear filters
            </button>
          ) : (
            <Link className="app-button" to="/workflows/new">
              Build a workflow
            </Link>
          )}
        </div>
      )}
      {listings.length > 0 && (
        <div className="app-panel workflow-market-results">
          <table className="workflow-market-table">
            <thead>
              <tr>
                <th scope="col">Workflow</th>
                <th scope="col">Tags</th>
                <th scope="col">Author</th>
                <th scope="col">Runs</th>
                <th scope="col">Copies</th>
                <th scope="col">Network</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="workflow-market-title" to={'/marketplace/' + item.id}>
                      {item.title}
                    </Link>
                    <p>{item.description}</p>
                  </td>
                  <td>
                    <div className="workflow-tags">
                      {item.tags.map((label) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={tag === label}
                          onClick={() => filter('tag', label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <a
                      target="_blank"
                      rel="noreferrer"
                      className="app-link"
                      href={getChain(5318007).explorerUrl + '/address/' + item.author}
                      title={item.author}
                    >
                      {short(item.author)}
                    </a>
                  </td>
                  <td>
                    <span className="workflow-mobile-label">Runs </span>
                    {item.runs.toLocaleString()}
                  </td>
                  <td>
                    <span className="workflow-mobile-label">Copies </span>
                    {item.copies.toLocaleString()}
                  </td>
                  <td>{chain.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          className="app-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage && <Spinner />}
          {query.isFetchingNextPage ? 'Loading more workflows' : 'Load more workflows'}
        </button>
      )}
    </section>
  );
}

export function WorkflowListingDetail() {
  const { listingId } = useParams();
  const query = useQuery({
    queryKey: ['workflow-listing-detail', listingId],
    enabled: Boolean(listingId),
    queryFn: async ({ signal }) => {
      const item = await workflowApi.listing(listingId!, signal);
      await verifyListing(item);
      return item;
    },
  });
  const item = query.data;
  if (!item)
    return (
      <section className="app-page workflow-page">
        <Link className="app-link" to="/marketplace">
          Back to Marketplace
        </Link>
        {query.isError ? (
          <p role="alert">{query.error.message}</p>
        ) : (
          <LoadingRegion label="Loading the workflow…" className="rb-page-skeleton">
            <Skeleton className="rb-skeleton--canvas" />
            <Skeleton className="rb-skeleton--panel" />
          </LoadingRegion>
        )}
      </section>
    );
  const draft = decodeWorkflow(item.program, item.title);
  return (
    <section className="app-page workflow-page">
      <Link className="app-link" to="/marketplace">
        Back to Marketplace
      </Link>
      <PageHeading title={item.title} description={item.description} />
      <div className="workflow-listing-meta">
        <AddressLink chainId={5318007} address={item.author} />
        <span>{item.runs.toLocaleString()} verified runs</span>
        <span>{item.copies.toLocaleString()} copies</span>
        <span>{chain.name}</span>
        <Link className="app-button app-button--primary" to={'/workflows/new?copy=' + item.id}>
          Copy workflow
        </Link>
      </div>
      <WorkflowGraph draft={draft} />
      <div className="app-panel app-panel-pad">
        <h2 className="app-panel-heading">What this workflow does</h2>
        <WorkflowOutline draft={draft} />
        <p className="app-copy">
          The author set a limit of {draft.spendLimit} USDC per run. You’ll choose your own limit
          and recipients when you copy it. Network fees apply when you activate and run your copy.
        </p>
      </div>
    </section>
  );
}

export function short(address: string) {
  return address.slice(0, 6) + '…' + address.slice(-4);
}
