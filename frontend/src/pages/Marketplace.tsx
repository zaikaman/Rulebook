import { TEMPLATES } from '@rulebook/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { CloneButton } from '../components/CloneButton.js';
import { ListingCard } from '../components/ListingCard.js';
import { EmptyState } from '../components/chrome/EmptyState.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { api } from '../lib/api.js';

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
    <section className="space-y-6">
      <PageHeading
        title="Rule marketplace"
        description="Public rules published by their owners. Cloning copies the exact parameters into your own vault; it never touches the author's funds."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Rule type
          <select
            value={template}
            onChange={(event) => {
              const value = event.target.value;
              setTemplate(value === 'all' ? 'all' : Number(value));
            }}
            className="rounded-lg border border-white/10 bg-[#04060a] px-3 py-2 text-sm text-neutral-100"
          >
            <option value="all">All rule types</option>
            {TEMPLATES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Sort by
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="rounded-lg border border-white/10 bg-[#04060a] px-3 py-2 text-sm text-neutral-100"
          >
            {SORT_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isLoading ? (
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div
              key={index}
              className="h-52 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]"
            />
          ))}
        </div>
      ) : query.error ? (
        <ErrorState
          message="The marketplace could not be loaded."
          detail={query.error instanceof Error ? query.error.message : null}
        />
      ) : listings.length === 0 ? (
        <EmptyState
          title="No public rules match these filters"
          description="Clear the rule-type filter, or publish one of your own rules from the composer to start the catalog."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-neutral-200 disabled:opacity-50"
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
