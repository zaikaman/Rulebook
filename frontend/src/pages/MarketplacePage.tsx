import { useState } from 'react';
import { Add01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from 'react-router';
import { PageHeading } from '@/components/chrome/PageHeading.js';
import { appRoutes } from '@/lib/routes.js';

interface TemplateItem {
  id: number;
  name: string;
  category: 'trading' | 'personal' | 'alert';
  trigger: string;
  condition: string;
  action: string;
  slots: number;
  description: string;
  caveat?: string;
}

const TEMPLATES: TemplateItem[] = [
  {
    id: 1,
    name: 'DCA',
    category: 'trading',
    trigger: 'cron',
    condition: 'timestamp_gate',
    action: 'swap',
    slots: 4,
    description: 'Dollar-cost average: scheduled token swaps at recurring intervals.',
  },
  {
    id: 2,
    name: 'DipBoostDCA',
    category: 'trading',
    trigger: 'cron',
    condition: 'price_below_previous_by_percent',
    action: 'swap',
    slots: 6,
    description:
      'Dynamic DCA: boosts purchase volume when current price is below cached reference.',
    caveat: 'Compares against latest Sync price cached on Reactive Agent.',
  },
  {
    id: 3,
    name: 'LimitBuy',
    category: 'trading',
    trigger: 'pair_sync',
    condition: 'price_below_threshold_before_expiry',
    action: 'swap',
    slots: 6,
    description: 'Decentralized limit buy executed on-chain as soon as pair trades below target.',
  },
  {
    id: 4,
    name: 'TakeProfit',
    category: 'trading',
    trigger: 'pair_sync',
    condition: 'price_above_threshold_before_expiry',
    action: 'swap',
    slots: 6,
    description: 'Automatically sells tokens into USDC when price surpasses upside target.',
  },
  {
    id: 5,
    name: 'StopLoss',
    category: 'trading',
    trigger: 'pair_sync',
    condition: 'price_below_threshold_with_trailing',
    action: 'swap',
    slots: 6,
    description: 'Protects principal by swapping to stablecoins when price breaks support.',
  },
  {
    id: 6,
    name: 'GridRebalance',
    category: 'trading',
    trigger: 'pair_sync',
    condition: 'price_moved_from_reference_by_percent',
    action: 'swap',
    slots: 6,
    description: 'Rebalance across a configured price band. Reference resets after fill.',
  },
  {
    id: 7,
    name: 'RecurringTransfer',
    category: 'personal',
    trigger: 'cron',
    condition: 'timestamp_gate',
    action: 'transfer',
    slots: 4,
    description: 'Automated payroll or allowance distributions on a fixed calendar schedule.',
  },
  {
    id: 8,
    name: 'IncomeSweep',
    category: 'personal',
    trigger: 'token_transfer',
    condition: 'incoming_amount_above_threshold',
    action: 'transfer',
    slots: 4,
    description: 'Splits large incoming deposits and routes a percentage directly to cold storage.',
  },
  {
    id: 9,
    name: 'BalanceFloor',
    category: 'personal',
    trigger: 'vault_balances',
    condition: 'balance_below_threshold',
    action: 'transfer_from',
    slots: 4,
    description: 'Refills your Vault from a linked source wallet whenever funds drop too low.',
    caveat: 'Source wallet approves Vault once to authorize floor transfers.',
  },
  {
    id: 10,
    name: 'DeadManSwitch',
    category: 'personal',
    trigger: 'cron',
    condition: 'inactivity_above_days',
    action: 'transfer',
    slots: 5,
    description:
      'Transfers Vault principal to emergency recovery address after specified inactivity.',
  },
  {
    id: 11,
    name: 'PriceAlert',
    category: 'alert',
    trigger: 'pair_sync',
    condition: 'price_crosses_threshold',
    action: 'alert',
    slots: 2,
    description: 'Emits an on-chain alert event when spot price crosses a specified level.',
  },
  {
    id: 12,
    name: 'RangeAlert',
    category: 'alert',
    trigger: 'pair_sync',
    condition: 'price_outside_range',
    action: 'alert',
    slots: 3,
    description: 'Monitors a price range and triggers notifications when volatility breaks out.',
  },
  {
    id: 13,
    name: 'LargeTransferAlert',
    category: 'alert',
    trigger: 'token_transfer',
    condition: 'amount_above_threshold',
    action: 'alert',
    slots: 2,
    description: 'Watches your wallet address and alerts on any transaction above threshold.',
  },
];

export function MarketplacePage() {
  const [filter, setFilter] = useState<'all' | 'trading' | 'personal' | 'alert'>('all');

  const filtered = TEMPLATES.filter((t) => (filter === 'all' ? true : t.category === filter));

  return (
    <div className="space-y-6">
      <PageHeading
        title="Template Marketplace"
        description="Public, unit-tested rule templates you can clone into your personal Vault with one signature."
      />

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

      {/* Grid of Templates */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="flex flex-col justify-between rounded-2xl border border-white/5 bg-white/[0.02] p-5 hover:border-white/10 transition-colors"
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-neutral-400">#{item.id}</span>
                <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] font-mono uppercase text-neutral-400">
                  {item.category}
                </span>
              </div>

              <h3 className="font-heading text-lg font-semibold text-white">{item.name}</h3>

              <p className="text-xs text-neutral-300 leading-relaxed">{item.description}</p>

              {item.caveat && (
                <p className="text-[11px] text-amber-400/90 bg-amber-400/10 border border-amber-400/20 rounded-lg p-2 leading-relaxed">
                  Notice: {item.caveat}
                </p>
              )}

              <div className="rounded-xl border border-white/5 bg-[#04060a] p-3 text-[11px] font-mono text-neutral-400 space-y-1">
                <div>Trigger: {item.trigger}</div>
                <div>Condition: {item.condition}</div>
                <div>
                  Action: {item.action} ({item.slots} slots)
                </div>
              </div>
            </div>

            <Link
              to={appRoutes.create}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-neutral-200 transition-colors"
            >
              <HugeiconsIcon icon={Add01Icon} size={14} />
              <span>Clone into Vault</span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
