import type { FastifyInstance } from 'fastify';

import type { ListingRow, RuleRow } from '../../db/repositories/index.js';
import type { ServerDeps } from '../../deps.js';
import { deriveRuleStats, ruleKey, statsFor, type RuleStats } from '../../marketplace/stats.js';

type Sort = 'newest' | 'runs' | 'success_rate';
const SORTS: readonly Sort[] = ['newest', 'runs', 'success_rate'];
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

interface ListingCursor {
  readonly agent: string;
  readonly rule_id: string;
}

function clampLimit(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

/** Opaque base64 cursor: the identity of the last row a client received. */
export function encodeListingCursor(row: ListingRow): string {
  const cursor: ListingCursor = { agent: row.agent, rule_id: row.rule_id };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
}

export function decodeListingCursor(cursor: string | undefined): ListingCursor | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      'agent' in parsed &&
      'rule_id' in parsed &&
      typeof parsed.agent === 'string' &&
      typeof parsed.rule_id === 'string'
    ) {
      return { agent: parsed.agent, rule_id: parsed.rule_id };
    }
  } catch {
    return null;
  }
  return null;
}

function parseSort(raw: string | undefined): Sort {
  return SORTS.includes(raw as Sort) ? (raw as Sort) : 'newest';
}

function sortValue(row: ListingRow, stats: RuleStats, sort: Sort): string | number {
  if (sort === 'runs') return stats.runs;
  if (sort === 'success_rate') return stats.successRate;
  return row.created_at;
}

function compareRows(
  left: ListingRow,
  right: ListingRow,
  stats: ReadonlyMap<string, RuleStats>,
  sort: Sort,
): number {
  const leftStats = statsFor(stats, left.agent, left.rule_id);
  const rightStats = statsFor(stats, right.agent, right.rule_id);
  const a = sortValue(left, leftStats, sort);
  const b = sortValue(right, rightStats, sort);

  if (a !== b) {
    if (typeof a === 'number' && typeof b === 'number') return b - a;
    return String(b).localeCompare(String(a));
  }
  // Stable tie-break so a cursor can resume without skipping or repeating a row.
  const agentOrder = left.agent.localeCompare(right.agent);
  if (agentOrder !== 0) return agentOrder;
  return Number(left.rule_id) - Number(right.rule_id);
}

function afterCursor(
  rows: readonly ListingRow[],
  cursor: ListingCursor | null,
): readonly ListingRow[] {
  if (!cursor) return rows;
  const index = rows.findIndex(
    (row) => row.agent === cursor.agent && row.rule_id === cursor.rule_id,
  );
  return index < 0 ? rows : rows.slice(index + 1);
}

function toListing(row: ListingRow, stats: RuleStats) {
  return {
    listing_id: row.listing_id,
    agent: row.agent,
    rule_id: row.rule_id,
    template: row.template,
    author: row.author,
    author_badge: row.author_badge,
    runs: stats.runs,
    success_rate: stats.successRate,
    cloned_count: 0,
    ...(row.name ? { name: row.name } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.metadata_uri ? { metadata_uri: row.metadata_uri } : {}),
    ...(row.params_hash ? { params_hash: row.params_hash } : {}),
  };
}

function toLeaderboardRow(
  row: RuleRow,
  rank: number,
  stats: RuleStats,
  badge: 'team' | 'community',
) {
  return {
    rank,
    agent: row.agent,
    rule_id: row.rule_id,
    template: row.template,
    runs: stats.runs,
    success_rate: stats.successRate,
    author_badge: badge,
  };
}

/** Registers `GET /v1/marketplace` and `GET /v1/leaderboard`. */
export function registerMarketplaceRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{
    Querystring: { template?: string; sort?: string; cursor?: string; limit?: string };
  }>('/v1/marketplace', async (request) => {
    const limit = clampLimit(request.query.limit);
    const sort = parseSort(request.query.sort);
    const template = request.query.template ? Number(request.query.template) : null;

    const [listings, executions] = await Promise.all([
      deps.repositories.listings.listPublic(),
      deps.repositories.executions.listAll(),
    ]);
    const stats = deriveRuleStats(executions);

    const filtered = listings.filter(
      (listing) => listing.is_public && (template === null || listing.template === template),
    );
    const sorted = [...filtered].sort((left, right) => compareRows(left, right, stats, sort));
    const page = afterCursor(sorted, decodeListingCursor(request.query.cursor)).slice(0, limit);
    const hasMore = sorted.length > page.length && page.length === limit;
    const last = page[page.length - 1];

    return {
      listings: page.map((listing) =>
        toListing(listing, statsFor(stats, listing.agent, listing.rule_id)),
      ),
      next_cursor: hasMore && last ? encodeListingCursor(last) : null,
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/v1/leaderboard', async (request) => {
    const limit = clampLimit(request.query.limit);
    const [rules, listings, executions] = await Promise.all([
      deps.repositories.rules.listAll(),
      deps.repositories.listings.listPublic(),
      deps.repositories.executions.listAll(),
    ]);
    const stats = deriveRuleStats(executions);
    const badges = new Map(
      listings.map((listing) => [ruleKey(listing.agent, listing.rule_id), listing.author_badge]),
    );

    const ranked = [...rules]
      .filter((rule) => rule.status !== 'cancelled')
      .sort((left, right) => {
        const a = statsFor(stats, left.agent, left.rule_id);
        const b = statsFor(stats, right.agent, right.rule_id);
        if (a.runs !== b.runs) return b.runs - a.runs;
        if (a.successRate !== b.successRate) return b.successRate - a.successRate;
        const agentOrder = left.agent.localeCompare(right.agent);
        if (agentOrder !== 0) return agentOrder;
        return Number(left.rule_id) - Number(right.rule_id);
      })
      .slice(0, limit);

    return {
      rows: ranked.map((rule, index) =>
        toLeaderboardRow(
          rule,
          index + 1,
          statsFor(stats, rule.agent, rule.rule_id),
          badges.get(ruleKey(rule.agent, rule.rule_id)) ?? 'community',
        ),
      ),
    };
  });
}
