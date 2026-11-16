import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';

/** Registers `GET /v1/marketplace` and `GET /v1/leaderboard`. */
export function registerMarketplaceRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/v1/marketplace', async () => {
    const listings = await deps.repositories.listings.list(25);
    return {
      listings: listings.map((listing) => ({
        listing_id: listing.listing_id,
        agent: listing.agent,
        rule_id: listing.rule_id,
        template: listing.template,
        author: listing.author,
        author_badge: listing.author_badge,
        runs: 0,
        success_rate: 0,
        cloned_count: 0,
      })),
      next_cursor: null,
    };
  });

  app.get('/v1/leaderboard', async () => ({ rows: [] }));
}
