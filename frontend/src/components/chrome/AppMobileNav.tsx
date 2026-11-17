import { Link, useLocation } from 'react-router';
import { useAccount, useConnect } from 'wagmi';

import { cx } from '@/lib/cx';
import { appRoutes, isActiveRoute } from '@/lib/routes';
import { Wordmark } from './Wordmark.js';

const items = [
  { label: 'Rules', href: appRoutes.rules, exact: true },
  { label: 'Create', href: appRoutes.create, exact: true },
  { label: 'Marketplace', href: appRoutes.marketplace, exact: true },
  { label: 'Leaderboard', href: appRoutes.leaderboard, exact: true },
  { label: 'Proof', href: appRoutes.proof, exact: false },
  { label: 'Account', href: appRoutes.account, exact: true },
  { label: 'Cost', href: appRoutes.cost, exact: true },
] as const;

export function AppMobileNav() {
  const { pathname } = useLocation();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const injectedConnector = connectors.find((connector) => connector.id === 'injected');

  return (
    <div className="lg:hidden sticky top-0 z-30 flex flex-col border-b border-white/5 bg-[#070707]/95 backdrop-blur-md">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
        <Link to={appRoutes.landing}>
          <Wordmark />
        </Link>
        <div>
          {isConnected ? (
            <span className="font-mono text-xs text-neutral-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
              {address?.slice(0, 5)}…{address?.slice(-3)}
            </span>
          ) : (
            <button
              type="button"
              disabled={!injectedConnector}
              onClick={() => injectedConnector && connect({ connector: injectedConnector })}
              className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black"
            >
              Connect
            </button>
          )}
        </div>
      </div>
      <nav className="flex gap-1.5 overflow-x-auto no-scrollbar px-4 py-2.5">
        {items.map((item) => {
          const active = isActiveRoute(pathname, item.href, item.exact);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex min-h-8 shrink-0 items-center rounded-full px-3 text-xs font-medium transition-colors',
                active
                  ? 'bg-white text-black'
                  : 'bg-white/[0.04] text-neutral-400 hover:text-white',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
