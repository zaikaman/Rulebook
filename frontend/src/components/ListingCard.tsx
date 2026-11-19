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
    <article aria-label={`${title} listing`} className="app-panel app-listing">
      <div className="app-panel-pad app-listing-body">
        <header className="flex items-start gap-3">
          <h2 className="app-panel-heading app-listing-title">{title}</h2>
          <span aria-label={team ? 'Team badge' : 'Community badge'} className="app-tag">
            {team ? 'Team' : 'Community'}
          </span>
        </header>

        {listing.description ? <p className="app-copy">{listing.description}</p> : null}

        <div className="app-listing-meta">
          {template ? <span>{template.name}</span> : null}
          <span className="font-mono text-ink-muted">#{listing.listing_id.toString()}</span>
        </div>
      </div>

      <footer className="app-divider app-listing-footer">
        <dl className="app-listing-stats text-xs text-ink-muted">
          <div>
            <dt>Runs</dt>
            <dd className="app-number font-mono text-ink">{listing.runs} runs</dd>
          </div>
          <div>
            <dt>Success rate</dt>
            <dd className="app-number font-mono text-ink">
              {successRateLabel(listing.success_rate)}
            </dd>
          </div>
          <div>
            <dt>Author</dt>
            <dd className="font-mono text-ink" title={listing.author}>
              {shortAddress(listing.author)}
            </dd>
          </div>
        </dl>
        {action}
      </footer>
    </article>
  );
}
