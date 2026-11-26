import { Link } from 'react-router';
import { Wordmark } from '@/components/chrome/Wordmark.js';
import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode.js';
import { appRoutes } from '@/lib/routes.js';
import { landingLinks } from './landing-links.js';

export function SiteFooter() {
  const { mode } = useNetworkMode();
  return (
    <footer className="relative z-10 border-t border-white/5 py-14">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Wordmark />
          <p className="max-w-sm text-sm font-light leading-relaxed text-neutral-400">
            Automate trades, transfers, and alerts with a vault owned by your wallet.
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
          <Link
            to={withNetworkQuery(appRoutes.workflows, mode)}
            className="text-white transition-colors hover:text-blue-200"
          >
            Open Rulebook
          </Link>
        </nav>
      </div>
      <div className="mx-auto mt-10 max-w-6xl px-6">
        <p className="border-t border-white/5 pt-6 text-xs font-light leading-relaxed text-neutral-400">
          Reactive Network, Uniswap, Unichain, and Base names and logos identify the networks and
          protocols Rulebook uses. They belong to their respective owners.
        </p>
      </div>
    </footer>
  );
}
