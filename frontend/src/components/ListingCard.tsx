import { getTemplate, type Listing } from '@rulebook/shared';
import type { ReactNode } from 'react';

import { listingTitle, shortAddress, successRateLabel } from '../lib/listings.js';

export interface ListingCardProps {
  readonly listing: Listing;
  /** The clone affordance; omitted in tests that only assert the published facts. */
  readonly action?: ReactNode;
}

/**
 * One marketplace listing. Every statistic printed here comes from the API's row (which is
 * derived from executions); the card never recalculates runs or success from other fields.
 * The author badge is rendered as published, so a team claim is never invented locally.
 */
export function ListingCard({ listing, action }: ListingCardProps) {
  const template = getTemplate(listing.template);
  const title = listingTitle(listing);
  const team = listing.author_badge === 'team';

  return (
    <article
      aria-label={`${title} listing`}
      className="flex flex-col justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-colors hover:border-white/10"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-neutral-500">#{listing.listing_id.toString()}</span>
          {template ? (
            <span className="rounded-full bg-white/5 px-2.5 py-0.5 font-mono text-[10px] uppercase text-neutral-400">
              {template.name}
            </span>
          ) : null}
          <span
            aria-label={team ? 'Team badge' : 'Community badge'}
            className={
              team
                ? 'rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300'
                : 'rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400'
            }
          >
            {team ? 'Team' : 'Community'}
          </span>
        </div>

        <h3 className="font-heading text-lg font-semibold text-white">{title}</h3>

        {listing.description ? (
          <p className="text-xs leading-relaxed text-neutral-300">{listing.description}</p>
        ) : null}

        <dl className="flex flex-wrap gap-5 text-xs text-neutral-400">
          <div className="flex gap-1.5">
            <dt>Runs</dt>
            <dd className="font-mono text-neutral-100">{listing.runs} runs</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Success rate</dt>
            <dd className="font-mono text-emerald-400">{successRateLabel(listing.success_rate)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Author</dt>
            <dd className="font-mono text-neutral-300" title={listing.author}>
              {shortAddress(listing.author)}
            </dd>
          </div>
        </dl>
      </div>

      {action ? <div className="flex flex-col gap-2">{action}</div> : null}
    </article>
  );
}
