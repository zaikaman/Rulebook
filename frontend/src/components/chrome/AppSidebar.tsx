import {
  Award01Icon,
  Book02Icon,
  Coins01Icon,
  DocumentValidationIcon,
  Store01Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from 'react-router';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

import { appRoutes } from '@/lib/routes';
import { NetworkBadge } from '../NetworkBadge.js';
import { SidebarSection } from './SidebarSection.js';
import { Wordmark } from './Wordmark.js';

export function AppSidebar() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const injectedConnector = connectors.find((connector) => connector.id === 'injected');

  return (
    <aside className="hidden lg:flex flex-col w-72 shrink-0 h-full p-8 border-r border-white/5 bg-[#070707] overflow-y-auto no-scrollbar">
      <Link
        to={appRoutes.landing}
        aria-label="Rulebook home"
        className="flex items-center gap-2 mb-8 pl-2"
      >
        <Wordmark />
      </Link>

      <nav className="space-y-1 flex-1">
        <SidebarSection
          label="Rules"
          href={appRoutes.rules}
          icon={Book02Icon}
          items={[{ label: 'Compose sentence', href: appRoutes.create }]}
        />
        <SidebarSection
          label="Marketplace"
          href={appRoutes.marketplace}
          icon={Store01Icon}
          items={[]}
        />
        <SidebarSection
          label="Leaderboard"
          href={appRoutes.leaderboard}
          icon={Award01Icon}
          items={[]}
        />
        <SidebarSection
          label="Proof Explorer"
          href={appRoutes.proof}
          icon={DocumentValidationIcon}
          items={[]}
        />
        <SidebarSection
          label="Account & Vault"
          href={appRoutes.account}
          icon={Wallet01Icon}
          items={[]}
        />
        <SidebarSection label="Cost Model" href={appRoutes.cost} icon={Coins01Icon} items={[]} />
      </nav>

      <div className="mt-auto pt-6 border-t border-white/5 space-y-4">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-xs">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] uppercase font-medium tracking-wider text-neutral-400">
              Wallet
            </span>
            {chainId !== undefined ? <NetworkBadge chainId={chainId} /> : null}
          </div>
          {isConnected ? (
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-white">
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </span>
              <button
                type="button"
                onClick={() => disconnect()}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-neutral-400 hover:text-white transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isPending || !injectedConnector}
              onClick={() => injectedConnector && connect({ connector: injectedConnector })}
              className="w-full rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black transition-all hover:bg-neutral-200 disabled:opacity-50"
            >
              {isPending ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>

        <Link
          to={appRoutes.landing}
          className="flex items-center justify-between px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
        >
          <span>Back to overview</span>
          <span className="font-mono text-[10px] text-neutral-400">ESC</span>
        </Link>
      </div>
    </aside>
  );
}
