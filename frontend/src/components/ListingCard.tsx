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
    <article aria-label={`${title} listing`} className="app-panel app-panel-pad grid gap-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">#{listing.listing_id.toString()}</span>
          {template ? <span className="app-tag">{template.name}</span> : null}
          <span
            aria-label={team ? 'Team badge' : 'Community badge'}
            className="app-tag ml-auto"
            data-tone={team ? 'positive' : undefined}
          >
            {team ? 'Team' : 'Community'}
          </span>
        </div>

        <h2 className="app-panel-heading break-words">{title}</h2>

        {listing.description ? <p className="app-copy">{listing.description}</p> : null}

        <dl className="app-divider flex flex-wrap gap-x-6 gap-y-3 pt-3 text-xs text-ink-muted">
          <div className="space-y-1">
            <dt>Runs</dt>
            <dd className="app-number font-mono text-ink">{listing.runs} runs</dd>
          </div>
          <div className="space-y-1">
            <dt>Success rate</dt>
            <dd className="app-number font-mono text-ink">
              {successRateLabel(listing.success_rate)}
            </dd>
          </div>
          <div className="space-y-1">
            <dt>Author</dt>
            <dd className="font-mono text-ink" title={listing.author}>
              {shortAddress(listing.author)}
            </dd>
          </div>
        </dl>
      </div>

      {action ? (
        <div className="app-divider flex flex-col items-start gap-2 pt-3">{action}</div>
      ) : null}
    </article>
  );
}
