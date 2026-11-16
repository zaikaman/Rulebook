import { Link, NavLink, Outlet } from 'react-router';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

import { NetworkBadge } from './NetworkBadge.js';

const NAV = [
  { to: '/', label: 'Rules' },
  { to: '/create', label: 'Create' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/account', label: 'Account' },
  { to: '/cost', label: 'Cost' },
] as const;

/** The application frame: navigation, wallet connection, and the custody statement. */
export function AppShell() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const injectedConnector = connectors.find((connector) => connector.id === 'injected');

  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <Link to="/" className="text-lg font-semibold">
            Rulebook
          </Link>
          <nav aria-label="Main" className="flex flex-wrap gap-3 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? 'font-medium text-ink' : 'text-ink-muted hover:text-ink'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {chainId !== undefined ? <NetworkBadge chainId={chainId} /> : null}
            {isConnected ? (
              <>
                <span className="font-mono text-xs text-ink-muted">
                  {address?.slice(0, 6)}…{address?.slice(-4)}
                </span>
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="rounded border border-border px-2 py-1"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={isPending || !injectedConnector}
                onClick={() => injectedConnector && connect({ connector: injectedConnector })}
                className="rounded border border-border px-2 py-1"
              >
                Connect wallet
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-border px-4 py-4 text-center text-xs text-ink-muted">
        The operator never holds custody of your principal. Sponsored credit covers execution only,
        and the indexer cannot move funds.
      </footer>
    </div>
  );
}
