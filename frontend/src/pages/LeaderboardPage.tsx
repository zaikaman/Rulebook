import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from 'react-router';
import { PageHeading } from '@/components/chrome/PageHeading.js';
import { appRoutes } from '@/lib/routes.js';

interface LeaderboardEntry {
  rank: number;
  template: string;
  creator: string;
  totalRuns: number;
  successRate: string;
  volumeSecured: string;
  gasSponsored: string;
}

const ENTRIES: LeaderboardEntry[] = [
  {
    rank: 1,
    template: 'DipBoostDCA (ETH/USDC)',
    creator: '0x89a1…412f',
    totalRuns: 1420,
    successRate: '99.8%',
    volumeSecured: '$284,000',
    gasSponsored: '12.4 ETH',
  },
  {
    rank: 2,
    template: 'Weekly Accumulator (BTC/USDC)',
    creator: '0x12c4…99b0',
    totalRuns: 980,
    successRate: '100%',
    volumeSecured: '$196,000',
    gasSponsored: '8.1 ETH',
  },
  {
    rank: 3,
    template: 'IncomeSweep (Treasury Splitter)',
    creator: '0x44d1…77a3',
    totalRuns: 640,
    successRate: '100%',
    volumeSecured: '$512,000',
    gasSponsored: '5.2 ETH',
  },
  {
    rank: 4,
    template: 'BalanceFloor (Safe Top-up)',
    creator: '0xfe30…1298',
    totalRuns: 412,
    successRate: '99.2%',
    volumeSecured: '$82,400',
    gasSponsored: '3.6 ETH',
  },
  {
    rank: 5,
    template: 'LimitBuy ($2,400 Dip Catcher)',
    creator: '0x71b9…56cc',
    totalRuns: 310,
    successRate: '98.7%',
    volumeSecured: '$155,000',
    gasSponsored: '2.8 ETH',
  },
];

export function LeaderboardPage() {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Automation Leaderboard"
        description="Public rule templates ranked by verified on-chain executions, uptime, and gas saved."
      />

      <div className="overflow-hidden rounded-3xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/5 bg-white/[0.01] text-xs font-mono uppercase text-neutral-400">
            <tr>
              <th className="py-4 pl-6 pr-3">Rank</th>
              <th className="px-4 py-4">Rule Template</th>
              <th className="px-4 py-4">Author</th>
              <th className="px-4 py-4">Total Runs</th>
              <th className="px-4 py-4">Success Rate</th>
              <th className="px-4 py-4">Volume</th>
              <th className="py-4 pl-4 pr-6 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {ENTRIES.map((entry) => (
              <tr key={entry.rank} className="hover:bg-white/[0.02] transition-colors">
                <td className="py-4 pl-6 pr-3 font-mono font-medium">
                  {entry.rank === 1 ? (
                    <span className="text-amber-400 font-bold">#1 🏆</span>
                  ) : entry.rank === 2 ? (
                    <span className="text-neutral-300 font-bold">#2 🥈</span>
                  ) : entry.rank === 3 ? (
                    <span className="text-amber-600 font-bold">#3 🥉</span>
                  ) : (
                    <span className="text-neutral-400">#{entry.rank}</span>
                  )}
                </td>
                <td className="px-4 py-4 font-heading font-medium text-white">{entry.template}</td>
                <td className="px-4 py-4 font-mono text-xs text-neutral-400">{entry.creator}</td>
                <td className="px-4 py-4 font-mono text-neutral-200">{entry.totalRuns} runs</td>
                <td className="px-4 py-4">
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-400">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} />
                    {entry.successRate}
                  </span>
                </td>
                <td className="px-4 py-4 font-mono text-neutral-300">{entry.volumeSecured}</td>
                <td className="py-4 pl-4 pr-6 text-right">
                  <Link
                    to={appRoutes.create}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-300 hover:text-white transition-colors"
                  >
                    Use template
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
