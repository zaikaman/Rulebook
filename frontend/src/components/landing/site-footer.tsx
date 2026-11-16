import { Link } from 'react-router';
import { Wordmark } from '@/components/chrome/Wordmark.js';
import { appRoutes } from '@/lib/routes.js';
import { landingLinks } from './landing-links.js';

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-white/5 py-14">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Wordmark />
          <p className="max-w-sm text-sm font-light leading-relaxed text-neutral-400">
            Rulebook turns personal on-chain money rules into self-executing automations without sacrificing custody or requiring gas tokens.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-3 text-sm md:items-end">
          {landingLinks.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="text-neutral-400 transition-colors hover:text-white"
            >
              {label}
            </a>
          ))}
          <Link to={appRoutes.rules} className="text-white transition-colors hover:text-blue-200">
            Open Rulebook App
          </Link>
        </nav>
      </div>
      <div className="mx-auto mt-10 max-w-6xl px-6">
        <p className="border-t border-white/5 pt-6 text-xs font-light leading-relaxed text-neutral-400">
          Rulebook is completely non-custodial: user funds remain in user-owned Vault contracts on destination chains. Reactive Network, Uniswap, and Unichain names and logos are trademarks of their respective foundations, shown solely to describe technical integrations.
        </p>
      </div>
    </footer>
  );
}
