import { useState } from 'react';
import {
  ArrowRight02Icon,
  CheckmarkCircle02Icon,
  Coins01Icon,
  SecurityCheckIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link, useNavigate } from 'react-router';
import { PageHeading } from '@/components/chrome/PageHeading.js';
import { appRoutes } from '@/lib/routes.js';

interface TemplateDef {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultSlots: Record<string, string>;
}

const TEMPLATES: TemplateDef[] = [
  {
    id: 'DipBoostDCA',
    name: 'DipBoostDCA',
    category: 'Trading',
    description: 'Buy on schedule, but boost purchase volume when price dips below reference.',
    defaultSlots: {
      schedule: 'Every Friday at 09:00 UTC',
      dipPercent: '5%',
      baseAmount: '100 USDC',
      boostAmount: '250 USDC',
      targetToken: 'ETH',
      dex: 'Uniswap V3',
    },
  },
  {
    id: 'DCA',
    name: 'Standard DCA',
    category: 'Trading',
    description: 'Recurring scheduled token purchase regardless of short-term volatility.',
    defaultSlots: {
      schedule: 'Every day at 00:00 UTC',
      amount: '50 USDC',
      targetToken: 'ETH',
      dex: 'Uniswap V3',
    },
  },
  {
    id: 'LimitBuy',
    name: 'On-Chain Limit Buy',
    category: 'Trading',
    description: 'Execute token swap as soon as spot market price crosses below your threshold.',
    defaultSlots: {
      pair: 'ETH/USDC',
      priceThreshold: '$2,450.00',
      swapAmount: '500 USDC',
      expiryDays: '14 days',
    },
  },
  {
    id: 'BalanceFloor',
    name: 'Balance Floor Guard',
    category: 'Personal',
    description: 'Automatically replenish Vault when operating balance drops below safe minimum.',
    defaultSlots: {
      floorAmount: '150 USDC',
      topupAmount: '500 USDC',
      sourceSafe: 'Personal Safe Vault',
    },
  },
  {
    id: 'IncomeSweep',
    name: 'Income Splitter & Sweep',
    category: 'Personal',
    description: 'Listen for incoming deposits and automatically allocate a portion to cold storage.',
    defaultSlots: {
      threshold: '500 USDC',
      splitPercent: '30%',
      targetVault: 'Cold Multi-Sig',
    },
  },
];

export function CreateRulePage() {
  const navigate = useNavigate();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDef>(TEMPLATES[0]!);
  const [slots, setSlots] = useState<Record<string, string>>(TEMPLATES[0]!.defaultSlots);
  const [isSigning, setIsSigning] = useState(false);
  const [signedSuccess, setSignedSuccess] = useState(false);

  const handleTemplateChange = (tmpl: TemplateDef) => {
    setSelectedTemplate(tmpl);
    setSlots(tmpl.defaultSlots);
  };

  const updateSlot = (key: string, value: string) => {
    setSlots((prev) => ({ ...prev, [key]: value }));
  };

  const handleSign = () => {
    setIsSigning(true);
    setTimeout(() => {
      setIsSigning(false);
      setSignedSuccess(true);
      setTimeout(() => {
        navigate(appRoutes.rules);
      }, 1500);
    }, 1200);
  };

  return (
    <div className="space-y-8">
      <PageHeading
        title="Compose a rule"
        description="Pick a template, choose values for fixed slots, and sign once. The operator funds execution."
      />

      {/* Template Selector Grid */}
      <div className="space-y-3">
        <label className="text-xs font-mono uppercase tracking-wider text-neutral-400">
          Step 1: Choose an automation template
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {TEMPLATES.map((tmpl) => {
            const active = tmpl.id === selectedTemplate.id;
            return (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => handleTemplateChange(tmpl)}
                className={`flex flex-col text-left p-4 rounded-2xl border transition-all ${
                  active
                    ? 'border-blue-500/60 bg-blue-950/20 shadow-[0_0_20px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/40'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-heading font-semibold text-white text-sm">{tmpl.name}</span>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-white/5 text-neutral-400">
                    {tmpl.category}
                  </span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">{tmpl.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sentence Assembler & Preview Side by Side */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left Column: Interactive Slot Chooser */}
        <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-400">
              Step 2: Fill template slots
            </span>
            <span className="text-xs text-blue-400 font-mono">No free-text code</span>
          </div>

          <div className="space-y-4">
            {Object.entries(slots).map(([key, val]) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs text-neutral-400 font-mono capitalize">
                  {key.replace(/([A-Z])/g, ' $1')}
                </label>
                <input
                  type="text"
                  value={val}
                  onChange={(e) => updateSlot(key, e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#04060a] px-3.5 py-2 text-sm text-white focus:border-blue-500 transition-colors"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Live Sentence & On-Chain Tx Preview */}
        <div className="space-y-6">
          {/* Assembled Sentence Box */}
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-6 space-y-4">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-blue-300">
              Live Assembled Sentence
            </span>
            <p className="font-sans text-xl font-medium leading-relaxed text-white">
              &ldquo;
              {selectedTemplate.id === 'DipBoostDCA' && (
                <>
                  <span className="text-blue-300">{slots.schedule}</span>, buy{' '}
                  <span className="text-emerald-400">{slots.baseAmount}</span> of{' '}
                  <span className="text-white font-bold">{slots.targetToken}</span>. If price drops{' '}
                  <span className="text-amber-400">{slots.dipPercent}</span> below last trade, boost
                  purchase to <span className="text-emerald-400">{slots.boostAmount}</span> via{' '}
                  <span className="text-neutral-400">{slots.dex}</span>.
                </>
              )}
              {selectedTemplate.id === 'DCA' && (
                <>
                  <span className="text-blue-300">{slots.schedule}</span>, swap{' '}
                  <span className="text-emerald-400">{slots.amount}</span> for{' '}
                  <span className="text-white font-bold">{slots.targetToken}</span> on{' '}
                  <span className="text-neutral-400">{slots.dex}</span>.
                </>
              )}
              {selectedTemplate.id === 'LimitBuy' && (
                <>
                  When <span className="text-blue-300">{slots.pair}</span> price drops below{' '}
                  <span className="text-amber-400">{slots.priceThreshold}</span> before{' '}
                  <span className="text-neutral-400">{slots.expiryDays}</span>, swap{' '}
                  <span className="text-emerald-400">{slots.swapAmount}</span>.
                </>
              )}
              {selectedTemplate.id === 'BalanceFloor' && (
                <>
                  When Vault balance is below{' '}
                  <span className="text-amber-400">{slots.floorAmount}</span>, transfer{' '}
                  <span className="text-emerald-400">{slots.topupAmount}</span> from{' '}
                  <span className="text-blue-300">{slots.sourceSafe}</span>.
                </>
              )}
              {selectedTemplate.id === 'IncomeSweep' && (
                <>
                  When incoming transfer exceeds{' '}
                  <span className="text-amber-400">{slots.threshold}</span>, sweep{' '}
                  <span className="text-emerald-400">{slots.splitPercent}</span> to{' '}
                  <span className="text-blue-300">{slots.targetVault}</span>.
                </>
              )}
              &rdquo;
            </p>
          </div>

          {/* Transaction Simulation & Sign Panel */}
          <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
            <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
              <span>On-Chain Dispatch Execution</span>
              <span className="text-emerald-400">Gas: 0.00 ETH (Sponsored)</span>
            </div>

            <div className="rounded-xl border border-white/5 bg-[#04060a] p-3 text-xs font-mono text-neutral-300 space-y-1">
              <div>Contract: ReactiveAgent.sol (Lasna)</div>
              <div>Destination: Vault.sol (Unichain Sepolia)</div>
              <div>Custody: 100% User Owned</div>
            </div>

            <button
              type="button"
              disabled={isSigning || signedSuccess}
              onClick={handleSign}
              className="w-full flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-black transition-all hover:bg-neutral-200 disabled:opacity-50"
            >
              {signedSuccess ? (
                <>
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} className="text-emerald-600" />
                  <span>Rule Signed & Active! Redirecting…</span>
                </>
              ) : isSigning ? (
                <span>Requesting Wallet Signature…</span>
              ) : (
                <>
                  <span>Sign Once & Deploy Rule</span>
                  <HugeiconsIcon icon={ArrowRight02Icon} size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
