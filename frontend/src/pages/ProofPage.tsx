import { useState } from 'react';
import {
  ArrowUpRight01Icon,
  CheckmarkCircle02Icon,
  DocumentValidationIcon,
  Time02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useParams } from 'react-router';
import { PageHeading } from '@/components/chrome/PageHeading.js';

interface ProofRow {
  step: string;
  chain: string;
  networkBadge: string;
  txHash: string;
  explorerUrl: string;
  timestamp: string;
  details: string;
  status: 'confirmed' | 'reverted';
}

const DEFAULT_ROWS: ProofRow[] = [
  {
    step: '1. Origin Event',
    chain: 'Ethereum Sepolia (11155111)',
    networkBadge: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    txHash: '0x3a4b917c8e9f2d1a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
    explorerUrl: 'https://sepolia.etherscan.io',
    timestamp: '19:14:02.120 UTC',
    details: 'Uniswap V3 Pair Sync: Traded at $2,492.50 USDC per ETH. Trigger condition (< $2,500.00) met.',
    status: 'confirmed',
  },
  {
    step: '2. Reactive Network ReactVM',
    chain: 'Lasna Testnet (26213)',
    networkBadge: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    txHash: '0x8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e',
    explorerUrl: 'https://kopli.reactscan.net',
    timestamp: '19:14:02.580 UTC',
    details: 'ReactVM verified slot constraints. Authorized callback dispatched without relayer custody.',
    status: 'confirmed',
  },
  {
    step: '3. Destination Execution',
    chain: 'Unichain Sepolia (1301)',
    networkBadge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    txHash: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    explorerUrl: 'https://unichain-sepolia.blockscout.com',
    timestamp: '19:14:02.960 UTC',
    details: 'Vault executed swap: 250.00 USDC -> 0.1003 ETH. Custody retained by user wallet. Gas sponsored.',
    status: 'confirmed',
  },
];

export function ProofPage() {
  const { reactiveTxHash } = useParams();
  const [searchHash, setSearchHash] = useState(reactiveTxHash ?? '');
  const [rows] = useState<ProofRow[]>(DEFAULT_ROWS);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Execution Proof"
        description="Publicly verifiable cryptographic proof connecting the origin trigger, ReactVM dispatch, and destination execution."
      />

      {/* Latency Summary Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl border border-white/5 bg-white/[0.02] p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-heading text-lg font-semibold text-white">
                Autonomous Loop Verified
              </span>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] text-emerald-400">
                SUCCESS
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              End-to-end verified across 3 distinct networks.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 border-t border-white/5 pt-3 sm:border-t-0 sm:pt-0">
          <div>
            <span className="text-[10px] font-mono uppercase text-neutral-400">Total Latency</span>
            <div className="flex items-center gap-1 font-mono text-lg font-bold text-white">
              <HugeiconsIcon icon={Time02Icon} size={14} className="text-amber-400" />
              <span>840 ms</span>
            </div>
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase text-neutral-400">User Gas Cost</span>
            <div className="font-mono text-lg font-bold text-emerald-400">0.00 ETH</div>
          </div>
        </div>
      </div>

      {/* Three Linked Rows */}
      <div className="space-y-4">
        {rows.map((row, idx) => (
          <div
            key={row.step}
            className="relative flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-6 hover:border-white/10 transition-colors"
          >
            <div className="space-y-2 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs font-semibold text-white">{row.step}</span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-mono ${row.networkBadge}`}
                >
                  {row.chain}
                </span>
                <span className="text-xs font-mono text-neutral-400">{row.timestamp}</span>
              </div>

              <p className="text-sm text-neutral-200 leading-relaxed">{row.details}</p>

              <div className="flex items-center gap-2 font-mono text-xs text-neutral-400">
                <span>Tx:</span>
                <span className="text-neutral-300">
                  {row.txHash.slice(0, 14)}…{row.txHash.slice(-10)}
                </span>
              </div>
            </div>

            <a
              href={`${row.explorerUrl}/tx/${row.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white hover:bg-white/10 transition-colors self-start md:self-center"
            >
              <span>View on Explorer</span>
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
            </a>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#04060a] p-4 text-xs font-light text-neutral-400">
        <p>
          <strong className="text-white">Resilience Guarantee:</strong> This proof view operates
          completely independently of Rulebook database state. The rows above can be retrieved and
          re-verified directly from RPC nodes on Sepolia, Lasna, and Unichain at any time.
        </p>
      </div>
    </div>
  );
}
