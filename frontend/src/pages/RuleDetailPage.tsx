import { useState } from 'react';
import {
  ArrowLeft02Icon,
  CheckmarkCircle02Icon,
  PauseIcon,
  PlayIcon,
  SecurityCheckIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link, useParams } from 'react-router';
import { PageHeading } from '@/components/chrome/PageHeading.js';
import { appRoutes } from '@/lib/routes.js';

export function RuleDetailPage() {
  const { agent, ruleId } = useParams();
  const [isActive, setIsActive] = useState(true);

  return (
    <div className="space-y-6">
      <Link
        to={appRoutes.rules}
        className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} size={14} />
        <span>Back to all rules</span>
      </Link>

      <PageHeading
        title={`Rule #${ruleId ?? '1'} Detail`}
        description="On-chain rule configuration, execution history, and contract linkage."
        aside={
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-colors"
          >
            <HugeiconsIcon icon={isActive ? PauseIcon : PlayIcon} size={14} />
            <span>{isActive ? 'Pause rule' : 'Resume rule'}</span>
          </button>
        }
      />

      {/* Main Sentence Card */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-8 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-wider text-blue-300">
            Active Assembled Sentence
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs ${
              isActive
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-neutral-500/10 text-neutral-400 border border-white/10'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isActive ? 'bg-emerald-400 shadow-[0_0_6px_#22c55e]' : 'bg-neutral-400'
              }`}
            />
            {isActive ? 'Active & Monitoring' : 'Paused by Owner'}
          </span>
        </div>

        <p className="font-sans text-2xl font-medium leading-relaxed text-white">
          &ldquo;When ETH drops 5% below last traded price, swap 250 USDC for ETH on Uniswap V3.&rdquo;
        </p>

        <div className="grid gap-4 sm:grid-cols-3 pt-4 border-t border-white/5 text-xs font-mono">
          <div>
            <span className="text-neutral-400 block mb-1">Reactive Agent (Lasna)</span>
            <span className="text-white">{agent ?? '0x1111…1111'}</span>
          </div>
          <div>
            <span className="text-neutral-400 block mb-1">Target Vault (Unichain)</span>
            <span className="text-white">0x2222…2222</span>
          </div>
          <div>
            <span className="text-neutral-400 block mb-1">Custody</span>
            <span className="text-emerald-400">100% User Owned</span>
          </div>
        </div>
      </div>

      {/* Execution history rows */}
      <div className="space-y-3">
        <h3 className="font-heading font-semibold text-white text-base">Execution History</h3>

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 flex items-center justify-between text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-white">Execution #14</span>
              <span className="text-emerald-400 font-mono">Verified (840ms delay)</span>
            </div>
            <p className="text-neutral-400">Swapped 250 USDC for 0.1003 ETH at $2,492.50</p>
          </div>
          <Link
            to="/proof/0x3a4b917c8e9f2d1a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-neutral-300 hover:text-white"
          >
            View proof
          </Link>
        </div>
      </div>
    </div>
  );
}
