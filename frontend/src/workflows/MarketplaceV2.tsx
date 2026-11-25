import { decodeWorkflowV2 } from '@rulebook/shared';
import { ArrowRight01Icon, Search01Icon, Store01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { CopyButton } from '@/components/chrome/CopyButton';
import { EmptyState } from '@/components/chrome/EmptyState';
import { PageHeading } from '@/components/chrome/PageHeading';
import { NetworkBadge } from '@/components/NetworkBadge';
import { CardGridSkeleton, LoadingRegion } from '@/components/chrome/Skeleton';
import { Spinner } from '@/components/chrome/Spinner';
import { WorkflowProgramSummary } from './BuilderV2';
import { ListingStatusV2 } from './ListingStatusV2';
import { workflowV2Deployment } from './chainV2';
import { toDraft } from './modelV2';
import { v2ApiBase, v2ListingId, v2ListingQuery, v2MarketPage } from './listingV2';
import {
  Badge,
  Button,
  ErrorState,
  FactList,
  Panel,
  PanelBody,
  PanelCopy,
  PanelHeader,
  PanelHeading,
  PanelTitle,
  Toolbar,
} from '@/ui';

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WorkflowMarketplaceV2() {
  const [search, setSearch] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['workflow-v2', 'marketplace', search],
    enabled: Boolean(workflowV2Deployment),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
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
  const filtered = search.trim().length > 0;

  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Discover"
        title="Marketplace"
        description="Browse testnet workflows published by other wallets and copy one as your own draft."
        aside={<span className="rb-chip rb-chip--plain">{items.length} listed</span>}
      />

      {!workflowV2Deployment && (
        <p className="rb-note">
          The Marketplace opens when the V2 testnet deployment is configured.
        </p>
      )}

      <Toolbar>
        <label className="rb-search">
          <span className="sr-only">Search listings</span>
          <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
          <input
            className="app-input"
            type="search"
            maxLength={160}
            value={search}
            placeholder="Search by name or description"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {filtered && (
          <Button variant="quiet" onClick={() => setSearch('')}>
            Clear
          </Button>
        )}
      </Toolbar>

      {query.error && (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      )}

      {query.isPending && Boolean(workflowV2Deployment) && (
        <LoadingRegion label="Loading Marketplace…">
          <CardGridSkeleton count={3} />
        </LoadingRegion>
      )}

      {query.isSuccess && !items.length && (
        <EmptyState
          icon={filtered ? Search01Icon : Store01Icon}
          title={filtered ? 'No listings match your search' : 'Nothing published yet'}
          description={
            filtered
              ? 'Try a shorter term, or clear the search to see every published workflow.'
              : 'Published workflows become starting points for other wallets. Publish one from its detail page to list it here.'
          }
          action={
            filtered ? (
              <button type="button" className="app-button" onClick={() => setSearch('')}>
                Clear search
              </button>
            ) : (
              <Link className="app-button app-button--primary" to="/workflows/new">
                Build a workflow
              </Link>
            )
          }
        />
      )}

      {!!items.length && (
        <ul className="rb-card-grid">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={`/marketplace/${item.id}`} className="rb-card">
                <div className="rb-card-body">
                  <div className="rb-card-head">
                    <span className="rb-card-icon" data-role="automation" aria-hidden="true">
                      <HugeiconsIcon icon={Store01Icon} size={18} strokeWidth={1.7} />
                    </span>
                    <div className="rb-card-heading">
                      <h2 className="rb-card-title">{item.title}</h2>
                      <p className="rb-card-meta font-mono">{shortAddress(item.owner)}</p>
                    </div>
                  </div>
                  <p className="rb-card-copy">{item.description}</p>
                </div>
                <div className="rb-card-foot">
                  <NetworkBadge chainId={item.chain} />
                  <span className="rb-card-cue">
                    Open
                    <HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" />
                  </span>
                </div>
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
          {query.isFetchingNextPage && <Spinner />}
          {query.isFetchingNextPage ? 'Loading more listings' : 'Load more listings'}
        </button>
      )}
    </section>
  );
}

export function WorkflowListingV2() {
  const { listingId } = useParams();
  const id = v2ListingId.safeParse(listingId);
  const query = useQuery(v2ListingQuery(id.data));
  if (!id.success) return <p role="alert">This listing link is invalid.</p>;
  if (!query.isFetchedAfterMount || !query.data || query.error || query.failureReason)
    return <ListingStatusV2 query={query} />;
  const item = query.data;

  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Marketplace"
        title={item.title}
        description={item.description}
        aside={
          <Link className="app-button app-button--primary" to={`/workflows/new?copy=${item.id}`}>
            Copy as draft
          </Link>
        }
      />
      <div className="rb-split">
        <Panel>
          <PanelHeader>
            <PanelHeading
              title="Program"
              description="The published trigger, checks, and actions."
            />
          </PanelHeader>
          <PanelBody>
            <WorkflowProgramSummary draft={toDraft(decodeWorkflowV2(item.program), item.title)} />
          </PanelBody>
        </Panel>
        <Panel className="rb-listing-details">
          <PanelHeader>
            <div className="rb-listing-details-heading">
              <span className="rb-listing-details-mark" aria-hidden="true">
                <HugeiconsIcon icon={Store01Icon} size={18} strokeWidth={1.7} />
              </span>
              <div>
                <PanelTitle>Listing details</PanelTitle>
                <PanelCopy>Published on the testnet Marketplace.</PanelCopy>
              </div>
            </div>
          </PanelHeader>
          <PanelBody>
            <FactList
              className="rb-listing-facts"
              items={[
                {
                  term: 'Published by',
                  valueClassName: 'rb-listing-address',
                  value: (
                    <>
                      <code title={item.owner}>{shortAddress(item.owner)}</code>
                      <CopyButton value={item.owner} label="publisher address" />
                    </>
                  ),
                },
                { term: 'Listing', valueClassName: 'rb-listing-id', value: `#${item.id}` },
                { term: 'Settlement', value: <NetworkBadge chainId={item.chain} /> },
                { term: 'Visibility', value: <Badge tone="active">Public</Badge> },
              ]}
            />
            <p className="rb-listing-note">
              Copying creates a private draft in the builder. Review each node and the spending
              limits before activating it from your own vault.
            </p>
            <div className="rb-action-row">
              <Link className="app-button" to="/marketplace">
                Back to Marketplace
              </Link>
            </div>
          </PanelBody>
        </Panel>
      </div>
    </section>
  );
}
