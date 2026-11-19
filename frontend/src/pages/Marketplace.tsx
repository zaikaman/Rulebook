import { Search01Icon, Store01Icon } from '@hugeicons/core-free-icons';
import { TEMPLATES } from '@rulebook/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { CloneButton } from '../components/CloneButton.js';
import { ListingCard } from '../components/ListingCard.js';
import { MirrorForm } from '../components/MirrorForm.js';
import { EmptyState } from '../components/chrome/EmptyState.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { api } from '../lib/api.js';
import { MIRROR_ENABLED } from '../lib/contracts.js';

type Sort = 'newest' | 'runs' | 'success_rate';

const SORT_LABELS: ReadonlyArray<{ value: Sort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'runs', label: 'Most runs' },
  { value: 'success_rate', label: 'Best success rate' },
];

/**
 * `/marketplace`: every public listing, filterable by template and sortable by the server.
 * Cursor pagination keeps the order stable while more pages load, and the first page is the
 * seeded team catalog, so a fresh deployment is never an empty screen (SC-013).
 */
export function Marketplace() {
  const [template, setTemplate] = useState<number | 'all'>('all');
  const [sort, setSort] = useState<Sort>('newest');

  const query = useInfiniteQuery({
    queryKey: ['marketplace', template, sort],
    queryFn: ({ pageParam }) =>
      api.marketplace({
        sort,
        ...(template === 'all' ? {} : { template }),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? null,
  });

  const listings = query.data?.pages.flatMap((page) => page.listings) ?? [];

  return (
    <section className="app-page app-marketplace">
      <PageHeading
        title="Rule marketplace"
        description="Explore public automations and clone their settings into your own account. Each copy uses your own vault."
      />
      {MIRROR_ENABLED ? <MirrorForm listings={listings} /> : null}

      <div className="app-panel app-panel-pad flex flex-wrap items-end gap-3">
        <label className="app-field w-full sm:w-52">
          Rule type
          <select
            value={template}
            onChange={(event) => {
              const value = event.target.value;
              setTemplate(value === 'all' ? 'all' : Number(value));
            }}
            className="app-input"
          >
            <option value="all">All rule types</option>
            {TEMPLATES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="app-field w-full sm:w-44">
          Sort by
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="app-input"
          >
            {SORT_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {query.isSuccess && listings.length > 0 ? (
          <p className="app-copy pb-2 sm:ml-auto" role="status">
            {listings.length} {listings.length === 1 ? 'rule' : 'rules'} shown
          </p>
        ) : null}
      </div>

      {query.isLoading ? (
        <div aria-label="Loading public rules" aria-busy="true" className="app-listing-grid">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="app-skeleton app-listing-skeleton animate-pulse" />
          ))}
        </div>
      ) : query.error ? (
        <ErrorState
          message="The marketplace could not be loaded."
          detail={query.error instanceof Error ? query.error.message : null}
          onRetry={() => void query.refetch()}
        />
      ) : listings.length === 0 ? (
        <EmptyState
          icon={template === 'all' ? Store01Icon : Search01Icon}
          title={template === 'all' ? 'No public rules yet' : 'No rules of this type'}
          description={
            template === 'all'
              ? 'Rules appear here when their owners publish them.'
              : 'Choose another rule type or browse the full marketplace.'
          }
          action={
            template === 'all' ? undefined : (
              <button type="button" className="app-button" onClick={() => setTemplate('all')}>
                Show all rule types
              </button>
            )
          }
        />
      ) : (
        <div className="space-y-5">
          <div className="app-listing-grid">
            {listings.map((listing) => (
              <ListingCard
                key={`${listing.agent}-${listing.rule_id.toString()}`}
                listing={listing}
                action={<CloneButton listing={listing} />}
              />
            ))}
          </div>

          {query.hasNextPage ? (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
                className="app-button"
              >
                {query.isFetchingNextPage ? 'Loading more…' : 'Load more rules'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
