import reactiveLogo from '@/assets/partners/reactive.svg';
import uniswapLogo from '@/assets/partners/uniswap.svg';
import unichainLogo from '@/assets/partners/unichain.svg';

const services = [
  {
    name: 'Reactive Network',
    logo: reactiveLogo,
    role: 'Your Agent watches for triggers and chooses a workflow path on Lasna.',
  },
  {
    name: 'Uniswap V2',
    logo: uniswapLogo,
    role: 'Your vault uses Uniswap pools to read prices and make swaps.',
  },
  {
    name: 'Unichain Sepolia',
    logo: unichainLogo,
    role: 'Your vault lives on this testnet, where swaps, transfers, and withdrawals settle.',
  },
] as const;

export function StackSection() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 pb-12 pt-4">
      <h2 className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_both] mb-6 text-xl font-medium tracking-tight text-white">
        Networks and protocols
      </h2>
      <ul className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_0.1s_both] grid divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] md:grid-cols-3 md:divide-x md:divide-y-0">
        {services.map((service) => (
          <li key={service.name} className="flex flex-col gap-3 p-6">
            <h3 className="flex items-center gap-3 text-sm font-medium text-white">
              <img
                src={service.logo}
                alt=""
                width={28}
                height={28}
                loading="lazy"
                decoding="async"
                className="size-7 shrink-0 object-contain"
              />
              {service.name}
            </h3>
            <p className="text-sm leading-relaxed text-neutral-400">{service.role}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
