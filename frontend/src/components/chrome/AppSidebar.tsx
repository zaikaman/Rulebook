import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ComponentProps } from 'react';
import { Link, useLocation } from 'react-router';

import { appRoutes, isActiveRoute } from '@/lib/routes';
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
  const active =
    isActiveRoute(pathname, href, exact ?? false) ||
    activeOn.some((path) => isActiveRoute(pathname, path, false));

  return (
    <Link
      to={href}
      data-active={active || undefined}
      aria-current={pathname === href ? 'page' : active ? 'location' : undefined}
      className="app-nav-item"
    >
      <HugeiconsIcon icon={icon} size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

export function AppSidebar() {
  return (
    <aside className="app-rail">
      <div className="app-rail-brand">
        <Link to={appRoutes.landing} aria-label="Rulebook home">
          <Wordmark />
        </Link>
        <span className="rb-chip rb-chip--plain">Testnet</span>
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
        <div className="app-rail-note">
          <p className="app-rail-note-title">
            <span className="app-live-dot" aria-hidden="true" />
            Reactive Lasna
          </p>
          <p>Watches for triggers. Unichain Sepolia settles from your vault.</p>
        </div>

        <Link to={appRoutes.landing} className="app-rail-back">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden="true" />
          <span>Back to overview</span>
        </Link>
      </div>
    </aside>
  );
}
