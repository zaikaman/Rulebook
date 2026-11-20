import { Award01Icon } from '@hugeicons/core-free-icons';
import { getTemplate, type LeaderboardRow } from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { EmptyState } from '../components/chrome/EmptyState.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { LoadingRegion, PanelSkeleton } from '../components/chrome/Skeleton.js';
import { ErrorState } from '../components/ErrorState.js';
import { api } from '../lib/api.js';
import { shortAddress } from '../lib/listings.js';
import { appRoutes } from '../lib/routes.js';

function templateLabel(row: LeaderboardRow): string {
  const template = row.template === undefined ? undefined : getTemplate(row.template);
  return template?.name ?? `Rule #${row.rule_id.toString()}`;
}

function successRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function LeaderboardTable({
  title,
  description,
  rows,
}: {
  readonly title: string;
  readonly description: string;
  readonly rows: readonly LeaderboardRow[];
}) {
  return (
    <section aria-label={title} className="app-panel">
      <header className="app-panel-pad space-y-1">
        <h2 className="app-panel-heading">{title}</h2>
        <p className="app-copy">{description}</p>
      </header>
      {rows.length === 0 ? (
        <p className="app-divider app-panel-pad text-sm text-ink-muted">
          No verified executions in this group yet.
        </p>
      ) : (
        <div
          className="app-table-wrap app-divider rounded-t-none"
          tabIndex={0}
          role="region"
          aria-label={`${title} rankings`}
        >
          <table className="app-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Rule</th>
                <th scope="col" className="app-number">
                  Runs
                </th>
                <th scope="col" className="app-number">
                  Success rate
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.agent}-${row.rule_id.toString()}`}>
                  <td className="font-mono text-ink-muted">#{row.rank}</td>
                  <td>
                    <span className="font-semibold">{templateLabel(row)}</span>
                    <span className="mt-0.5 block font-mono text-xs text-ink-muted">
                      {shortAddress(row.agent)}
                    </span>
                  </td>
                  <td className="app-number font-mono">{row.runs}</td>
                  <td className="app-number font-mono">{successRate(row.success_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * `/leaderboard`: the same ranked feed split by author provenance, so a team rule never hides
 * among community rules and a community rule never borrows a team claim (FR-041).
 */
export function Leaderboard() {
  const query = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => api.leaderboard(),
    retry: false,
  });

  const team = query.data?.rows.filter((row) => row.author_badge === 'team') ?? [];
  const community = query.data?.rows.filter((row) => row.author_badge === 'community') ?? [];

  return (
    <section className="app-page app-leaderboard">
      <PageHeading
        title="Automation leaderboard"
        description="Public rules ranked by verified executions, with success rate as the tiebreaker."
      />

      {query.isLoading ? (
        <LoadingRegion label="Loading rankings">
          <PanelSkeleton rows={3} rowClassName="rb-skeleton--table-row" />
        </LoadingRegion>
      ) : query.error ? (
        <ErrorState
          message="The leaderboard could not be loaded."
          detail={query.error instanceof Error ? query.error.message : null}
          onRetry={() => void query.refetch()}
        />
      ) : team.length === 0 && community.length === 0 ? (
        <EmptyState
          icon={Award01Icon}
          title="No executions to rank yet"
          description="Public rules appear in the rankings after their first verified execution."
          action={
            <Link to={appRoutes.marketplace} className="app-button">
              Browse public rules
            </Link>
          }
        />
      ) : (
        <div className="grid gap-5">
          <LeaderboardTable
            title="Team rules"
            description="Rules published by the Rulebook team."
            rows={team}
          />
          <LeaderboardTable
            title="Community rules"
            description="Rules published by individual automation owners."
            rows={community}
          />
        </div>
      )}
    </section>
  );
}
