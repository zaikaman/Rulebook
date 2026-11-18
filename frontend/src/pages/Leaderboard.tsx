import { getTemplate, type LeaderboardRow } from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '../components/chrome/EmptyState.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { api } from '../lib/api.js';
import { shortAddress } from '../lib/listings.js';

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
    <section aria-label={title} className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="text-xs text-neutral-400">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-neutral-400">
          No {title.toLowerCase()} rules have an execution record yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/5 text-xs font-mono uppercase text-neutral-400">
              <tr>
                <th className="py-3 pl-5 pr-3">Rank</th>
                <th className="px-3 py-3">Rule</th>
                <th className="px-3 py-3">Runs</th>
                <th className="py-3 pl-3 pr-5">Success rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row) => (
                <tr key={`${row.agent}-${row.rule_id.toString()}`}>
                  <td className="py-3 pl-5 pr-3 font-mono text-neutral-300">#{row.rank}</td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-white">{templateLabel(row)}</span>
                    <span className="block font-mono text-[10px] text-neutral-500">
                      {shortAddress(row.agent)}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-neutral-200">{row.runs}</td>
                  <td className="py-3 pl-3 pr-5 font-mono text-emerald-400">
                    {successRate(row.success_rate)}
                  </td>
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
    <section className="space-y-6">
      <PageHeading
        title="Automation leaderboard"
        description="Rules ranked by verified executions, then by success rate. Statistics come from indexed execution records, never from a self-reported claim."
      />

      {query.isLoading ? (
        <div aria-busy="true" className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-16 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]"
            />
          ))}
        </div>
      ) : query.error ? (
        <ErrorState
          message="The leaderboard could not be loaded."
          detail={query.error instanceof Error ? query.error.message : null}
        />
      ) : team.length === 0 && community.length === 0 ? (
        <EmptyState
          title="No executions to rank yet"
          description="The leaderboard fills as rules execute. A rule with no execution record is never given a placeholder score."
        />
      ) : (
        <div className="space-y-8">
          <LeaderboardTable
            title="Team rules"
            description="Published by the Rulebook team. Badges mirror the listing registry; no local rule can claim one."
            rows={team}
          />
          <LeaderboardTable
            title="Community rules"
            description="Published by their owners. Same execution-counted statistics as the team catalog."
            rows={community}
          />
        </div>
      )}
    </section>
  );
}
