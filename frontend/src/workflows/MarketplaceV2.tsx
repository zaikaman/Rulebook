import { decodeWorkflowV2 } from '@rulebook/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageHeading } from '@/components/chrome/PageHeading';
import { V2Field, WorkflowProgramSummary } from './BuilderV2';
import { workflowV2Deployment } from './chainV2';
import { toDraft } from './modelV2';
import { getV2Listing, v2ApiBase, v2ListingId, v2MarketPage } from './listingV2';

export function WorkflowMarketplaceV2() {
  const [search, setSearch] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['workflow-v2', 'marketplace', search],
    enabled: Boolean(workflowV2Deployment),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ q: search, ...(pageParam ? { after: pageParam } : {}) });
      const response = await fetch(`${v2ApiBase}/v3/marketplace?${params}`, { signal });
      if (!response.ok) throw new Error('The Marketplace could not load.');
      return v2MarketPage.parse(await response.json());
    },
    getNextPageParam: (result) => result.nextCursor,
  });
  const items = query.data?.pages.flatMap((result) => result.listings) ?? [];
  return (
    <section className="app-page workflow-page workflow-v2-stack">
      <PageHeading
        title="Marketplace"
        description="Browse testnet workflows published by other wallets and open one as your own draft."
      />
      <V2Field name="Search listings">
        <input
          className="app-input"
          type="search"
          maxLength={160}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </V2Field>
      {query.isFetching && !query.data && <p role="status">Loading Marketplace…</p>}
      {query.error && (
        <p className="workflow-error" role="alert">
          {query.error.message}
        </p>
      )}
      {(!workflowV2Deployment || (query.isSuccess && !items.length)) && (
        <p className="app-copy">No matching workflows are published yet.</p>
      )}
      {!!items.length && (
        <ul className="app-panel workflow-workspace-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={`/marketplace/${item.id}`} className="workflow-workspace-row">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          className="app-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more listings
        </button>
      )}
    </section>
  );
}

export function WorkflowListingV2() {
  const { listingId } = useParams();
  const id = v2ListingId.safeParse(listingId);
  const query = useQuery({
    queryKey: ['workflow-v2', 'listing', listingId],
    enabled: id.success,
    queryFn: ({ signal }) => getV2Listing(id.data!, signal),
  });
  if (!id.success) return <p role="alert">This listing link is invalid.</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data) return <p role="status">Reading the published workflow…</p>;
  const item = query.data;
  return (
    <section className="app-page workflow-page workflow-v2-stack">
      <PageHeading title={item.title} description={item.description} />
      <p className="workflow-v2-address">Published by {item.owner}</p>
      <div className="app-panel app-panel-pad">
        <WorkflowProgramSummary draft={toDraft(decodeWorkflowV2(item.program), item.title)} />
      </div>
      <div className="workflow-actions">
        <Link className="app-button app-button--primary" to={`/workflows/new?copy=${item.id}`}>
          Copy as draft
        </Link>
        <Link className="app-button" to="/marketplace">
          Back to Marketplace
        </Link>
      </div>
    </section>
  );
}
