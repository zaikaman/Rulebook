import {
  ArrowLeft01Icon,
  Award01Icon,
  Book02Icon,
  Coins01Icon,
  DocumentValidationIcon,
  Store01Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
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

      <nav aria-label="Workspace" className="space-y-1 flex-1">
        <SidebarSection
          label="Rules"
          href={appRoutes.rules}
          icon={Book02Icon}
          nested
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
          nested
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

      <div className="app-divider mt-auto space-y-4 pt-6">
        <div className="app-panel p-3 text-xs">
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
                className="app-button min-h-8 px-2.5 text-xs"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isPending || !injectedConnector}
              onClick={() => injectedConnector && connect({ connector: injectedConnector })}
              className="app-button app-button--primary w-full"
            >
              {isPending ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>

        <Link
          to={appRoutes.landing}
          className="flex items-center gap-2 px-2 py-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden="true" />
          <span>Back to overview</span>
        </Link>
      </div>
    </aside>
  );
}
