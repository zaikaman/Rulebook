import { useState } from 'react';
import {
  Add01Icon,
  Book02Icon,
  CheckmarkCircle02Icon,
  PauseIcon,
  PlayIcon,
  SecurityCheckIcon,
  Time02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from 'react-router';
import { PageHeading } from '@/components/chrome/PageHeading.js';
import { appRoutes } from '@/lib/routes.js';

interface RuleItem {
  id: string;
  name: string;
  category: 'trading' | 'personal' | 'alert';
  sentence: string;
  status: 'active' | 'paused' | 'latched';
  executions: number;
  lastRun: string;
  agentChain: string;
  vaultChain: string;
}

const INITIAL_RULES: RuleItem[] = [
  {
    id: '1',
    name: 'DipBoostDCA',
    category: 'trading',
    sentence: 'When ETH price drops 5% below last traded price, swap 250 USDC for ETH on Uniswap V3.',
    status: 'active',
    executions: 14,
    lastRun: '12 minutes ago',
    agentChain: 'Lasna (Reactive)',
    vaultChain: 'Unichain Sepolia',
  },
  {
    id: '2',
    name: 'Weekly Scheduled Buy',
    category: 'trading',
    sentence: 'Every Friday at 09:00 UTC, swap 50 USDC for ETH with max slippage 0.5%.',
    status: 'active',
    executions: 8,
    lastRun: '3 days ago',
    agentChain: 'Lasna (Reactive)',
    vaultChain: 'Unichain Sepolia',
  },
  {
    id: '3',
    name: 'IncomeSweep',
    category: 'personal',
    sentence: 'When incoming transfer is above 500 USDC, transfer 25% of the deposit to Cold Vault.',
    status: 'active',
    executions: 3,
    lastRun: '1 week ago',
    agentChain: 'Lasna (Reactive)',
    vaultChain: 'Unichain Sepolia',
  },
  {
    id: '4',
    name: 'BalanceFloor Alert',
    category: 'alert',
    sentence: 'When Vault balance drops below 100 USDC, emit cross-chain alert to notify operator.',
    status: 'latched',
    executions: 1,
    lastRun: '2 weeks ago',
    agentChain: 'Lasna (Reactive)',
    vaultChain: 'Unichain Sepolia',
  },
];

export function RulesPage() {
  const [rules, setRules] = useState<RuleItem[]>(INITIAL_RULES);
  const [filter, setFilter] = useState<'all' | 'trading' | 'personal' | 'alert'>('all');

  const toggleStatus = (id: string) => {
    setRules((prev) =>
      prev.map((rule) => {
        if (rule.id !== id) return rule;
        return {
          ...rule,
          status: rule.status === 'active' ? 'paused' : 'active',
        };
      }),
    );
  };

  const filteredRules = rules.filter((r) => (filter === 'all' ? true : r.category === filter));

  return (
    <div className="space-y-6">
      <PageHeading
        title="Your rules"
        description="Autonomous smart-contract rules evaluated continuously on Reactive Network."
        aside={
          <Link
            to={appRoutes.create}
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-semibold text-black hover:bg-neutral-200 transition-colors"
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            <span>Assemble new rule</span>
          </Link>
        }
      />

      {/* Overview Stat Trio */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
            <span>Active automations</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#22c55e]" />
          </div>
          <span className="font-heading text-2xl font-bold text-white">
            {rules.filter((r) => r.status === 'active').length} Active
          </span>
          <p className="mt-1 text-xs text-neutral-400">Evaluated in order on Lasna ReactVM</p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
            <span>Protected Vault Principal</span>
            <HugeiconsIcon icon={SecurityCheckIcon} size={14} className="text-blue-400" />
          </div>
          <span className="font-heading text-2xl font-bold text-white">$4,250.00 USDC</span>
          <p className="mt-1 text-xs text-neutral-400">100% user custody on Unichain Sepolia</p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
            <span>Operator Sponsored Gas</span>
            <span className="font-mono text-[10px] text-emerald-400">100% COVERED</span>
          </div>
          <span className="font-heading text-2xl font-bold text-white">0.00 ETH User Cost</span>
          <p className="mt-1 text-xs text-neutral-400">26 total automated runs executed</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-white/5 pb-3">
        {(['all', 'trading', 'personal', 'alert'] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={`rounded-full px-3.5 py-1 text-xs font-medium capitalize transition-colors ${
              filter === cat
                ? 'bg-white text-black'
                : 'bg-white/[0.04] text-neutral-400 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Rules list */}
      <div className="space-y-3">
        {filteredRules.map((rule, idx) => (
          <div
            key={rule.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-5 hover:border-white/10 transition-colors"
          >
            <div className="space-y-2 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs text-neutral-400">#{idx + 1}</span>
                <span className="font-medium text-white text-base">{rule.name}</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                    rule.status === 'active'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : rule.status === 'latched'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-neutral-500/10 text-neutral-400 border border-white/10'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      rule.status === 'active'
                        ? 'bg-emerald-400 shadow-[0_0_6px_#22c55e]'
                        : rule.status === 'latched'
                          ? 'bg-amber-400'
                          : 'bg-neutral-400'
                    }`}
                  />
                  {rule.status}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-neutral-400 capitalize">
                  {rule.category}
                </span>
              </div>

              <p className="font-sans text-sm text-neutral-200 leading-relaxed">
                &ldquo;{rule.sentence}&rdquo;
              </p>

              <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400 font-mono">
                <span>Agent: {rule.agentChain}</span>
                <span>&bull;</span>
                <span>Vault: {rule.vaultChain}</span>
                <span>&bull;</span>
                <span className="inline-flex items-center gap-1 text-neutral-400">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} className="text-emerald-400" />
                  {rule.executions} runs
                </span>
                <span>&bull;</span>
                <span className="inline-flex items-center gap-1 text-neutral-400">
                  <HugeiconsIcon icon={Time02Icon} size={12} />
                  {rule.lastRun}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                type="button"
                onClick={() => toggleStatus(rule.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 hover:text-white transition-colors"
              >
                <HugeiconsIcon icon={rule.status === 'active' ? PauseIcon : PlayIcon} size={13} />
                <span>{rule.status === 'active' ? 'Pause' : 'Resume'}</span>
              </button>

              <Link
                to={`/rules/0x1111111111111111111111111111111111111111/${rule.id}`}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 hover:text-white transition-colors"
              >
                Detail
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
