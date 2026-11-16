import reactiveLogo from '@/assets/partners/reactive.svg';
import uniswapLogo from '@/assets/partners/uniswap.svg';
import unichainLogo from '@/assets/partners/unichain.svg';
import ethLogo from '@/assets/partners/ethereum.svg';

const services = [
  {
    name: 'Reactive Network',
    logo: reactiveLogo,
    logoClassName: 'h-6',
    role: 'Watches the world on Lasna, executes cross-chain logic in ReactVM without custody.',
  },
  {
    name: 'Uniswap V3',
    logo: uniswapLogo,
    logoClassName: 'h-6',
    role: 'Executes spot automations, DCA, and rebalances against decentralized liquidity pools.',
  },
  {
    name: 'Unichain Sepolia',
    logo: unichainLogo,
    logoClassName: 'h-6',
    role: 'Hosts your personal non-custodial Vault. Only your wallet can withdraw principal.',
  },
  {
    name: 'Sponsored Relayer',
    logo: ethLogo,
    logoClassName: 'h-6',
    role: 'Pays gas and contract deployment costs. You keep the money, the operator pays the execution.',
  },
] as const;

export function StackSection() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 pb-12 pt-4">
      <p className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_both] mb-6 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-400">
        Infrastructure & Networks
      </p>
      <ul className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_0.1s_both] grid overflow-hidden rounded-3xl border border-white/5 bg-white/[0.02] sm:grid-cols-2 lg:grid-cols-4">
        {services.map((service) => (
          <li
            key={service.name}
            className="flex flex-col gap-4 border-white/5 p-6 not-last:border-b sm:odd:border-r lg:border-b-0 lg:not-last:border-r"
          >
            <span className="flex h-12 items-center">
              <img
                src={service.logo}
                alt={service.name}
                loading="lazy"
                decoding="async"
                className={`w-auto ${service.logoClassName}`}
              />
            </span>
            <p className="text-xs font-light leading-relaxed text-neutral-400">{service.role}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
