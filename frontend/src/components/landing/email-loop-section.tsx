import { Activity01Icon, CheckmarkCircle02Icon, SentIcon, Shield01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { PhoneShowcase } from './phone-showcase.js';
import { SectionHeading } from './section-heading.js';

const exchanges = [
  {
    direction: 'out' as const,
    icon: Activity01Icon,
    label: 'Origin Chain Event',
    body: 'Sepolia Uniswap V3 Pool emits Sync: ETH traded at $2,492.50. Target was below $2,500.00.',
  },
  {
    direction: 'in' as const,
    icon: SentIcon,
    label: 'Reactive Network Verification',
    body: 'Your Agent on Lasna catches the event in real-time, verifies slot constraints, and computes call authorization.',
  },
  {
    direction: 'out' as const,
    icon: Shield01Icon,
    label: 'Zero-Gas Cross-Chain Dispatch',
    body: 'ReactVM dispatches cross-chain callback to Unichain Sepolia. The operator pays 100% of the gas cost.',
  },
  {
    direction: 'in' as const,
    icon: CheckmarkCircle02Icon,
    label: 'Destination Vault Settlement',
    body: 'Vault executes swap on Uniswap: 250 USDC -> 0.1003 ETH. Full proof recorded on public explorer.',
  },
] as const;

export function EmailLoopSection() {
  return (
    <section id="reactive-loop" className="relative z-10 mx-auto max-w-6xl scroll-mt-28 px-6 py-20">
      <SectionHeading
        eyebrow="The autonomous loop"
        title="You never have to keep a server awake"
        lede="No cloud cron jobs. No API keys to leak. The Reactive Network executes your logic on-chain with zero devops."
      />

      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <PhoneShowcase />

        <div className="flex flex-col gap-3">
          {exchanges.map((exchange, index) => {
            const outbound = exchange.direction === 'out';
            return (
              <div
                key={exchange.label}
                className={`animate-on-scroll flex max-w-[88%] flex-col gap-2 rounded-3xl border p-5 ${
                  outbound
                    ? 'self-start border-white/5 bg-white/[0.03]'
                    : 'self-end border-blue-500/20 bg-blue-950/20'
                }`}
                style={{ animation: `fadeInUp 0.6s ease-out ${String(index * 0.1)}s both` }}
              >
                <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                  <HugeiconsIcon icon={exchange.icon} size={12} />
                  {exchange.label}
                </span>
                <p
                  className={`text-sm font-light leading-relaxed ${outbound ? 'text-neutral-300' : 'text-blue-100'}`}
                >
                  {exchange.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <p className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_0.4s_both] mt-10 max-w-2xl border-l border-blue-500/30 pl-5 text-sm font-light leading-relaxed text-neutral-400">
        The operator never holds custody of your principal. Sponsored execution credit covers gas only,
        and no off-chain runner has authorization to withdraw your funds.
      </p>
    </section>
  );
}
