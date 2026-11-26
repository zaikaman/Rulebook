import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { getChain } from '@rulebook/shared';
import type { ComponentProps } from 'react';
import { Link, useLocation } from 'react-router';

import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { appRoutes, isActiveRoute } from '@/lib/routes';
import { Badge } from '@/ui';
import { NewWorkflowLink } from './NewWorkflowLink.js';
import { Wordmark } from './Wordmark.js';
import { workflowNavigation } from './workflowNavigation.js';

interface RailItem {
  readonly label: string;
  readonly href: string;
  readonly icon: ComponentProps<typeof HugeiconsIcon>['icon'];
  readonly activeOn?: readonly string[];
  readonly exact?: boolean;
}

const groups: readonly { readonly label: string; readonly items: readonly RailItem[] }[] = [
  {
    label: 'Automation',
    items: workflowNavigation.filter(
      ({ href }) => href === appRoutes.workflows || href === appRoutes.activity,
    ),
  },
  {
    label: 'Discover',
    items: workflowNavigation.filter(
      ({ href }) => href === appRoutes.marketplace || href === appRoutes.proof,
    ),
  },
  {
    label: 'Manage',
    items: workflowNavigation.filter(
      ({ href }) => href === appRoutes.account || href === appRoutes.cost,
    ),
  },
];

function RailLink({ label, href, icon, activeOn = [], exact }: RailItem) {
  const { pathname } = useLocation();
  const { mode } = useNetworkMode();
  const active =
    isActiveRoute(pathname, href, exact ?? false) ||
    activeOn.some((path) => isActiveRoute(pathname, path, false));

  return (
    <Link
      to={withNetworkQuery(href, mode)}
      data-active={active || undefined}
      aria-current={pathname === href ? 'page' : active ? 'location' : undefined}
      className="app-nav-item"
    >
      <HugeiconsIcon icon={icon} size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

function formatChainList(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function formatSettlementSummary(
  chainNames: readonly string[],
  isDeploymentConfigured: boolean,
): string {
  const formattedChains = formatChainList(chainNames);
  if (!isDeploymentConfigured) {
    return formattedChains
      ? `Contracts are not deployed in this environment yet. Settlement targets ${formattedChains}.`
      : 'Contracts are not deployed in this environment yet.';
  }
  if (chainNames.length === 0) {
    return 'Watches for triggers and settles approved actions from your vaults.';
  }
  if (chainNames.length === 1) {
    return `Watches for triggers. ${formattedChains} settles from your vault.`;
  }
  return `Watches for triggers. ${formattedChains} settle from your vaults.`;
}

export function AppSidebar() {
  const { mode, isMainnet, automationName, configuredFundsChains, isDeploymentConfigured } =
    useNetworkMode();
  const fundsChainNames = configuredFundsChains.map((chainId) => getChain(chainId).name);
  const settlementSummary = formatSettlementSummary(fundsChainNames, isDeploymentConfigured);

  return (
    <aside className="app-rail" data-network-mode={mode}>
      <div className="app-rail-brand">
        <Link to={withNetworkQuery(appRoutes.landing, mode)} aria-label="Rulebook home">
          <Wordmark />
        </Link>
        <Badge
          tone={isMainnet ? 'paused' : undefined}
          plain={!isMainnet}
          data-testid="sidebar-network-mode"
        >
          {isMainnet ? 'Mainnet' : 'Testnet'}
        </Badge>
      </div>

      <div className="app-rail-cta">
        <NewWorkflowLink />
      </div>

      <nav aria-label="Workspace" className="app-rail-nav">
        {groups.map((group) => (
          <div key={group.label} className="app-nav-group">
            <p className="app-nav-label">{group.label}</p>
            {group.items.map((item) => (
              <RailLink key={item.href} {...item} />
            ))}
          </div>
        ))}
      </nav>

      <div className="app-rail-footer">
        <div className="app-rail-note" data-testid="sidebar-network-note">
          <p className="app-rail-note-title" data-testid="sidebar-automation-network">
            {isDeploymentConfigured && <span className="app-live-dot" aria-hidden="true" />}
            {automationName}
          </p>
          <p data-testid="sidebar-funds-summary">{settlementSummary}</p>
        </div>

        <Link to={withNetworkQuery(appRoutes.landing, mode)} className="app-rail-back">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden="true" />
          <span>Back to overview</span>
        </Link>
      </div>
    </aside>
  );
}
