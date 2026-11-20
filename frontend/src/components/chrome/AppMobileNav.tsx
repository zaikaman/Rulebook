import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';

import { appRoutes, isActiveRoute, legacyWorkspace } from '@/lib/routes';
import { NewWorkflowLink } from './NewWorkflowLink.js';
import { WalletControl } from './WalletControl.js';
import { Wordmark } from './Wordmark.js';
import { workflowNavigation } from './workflowNavigation.js';

const legacyNavigation = [
  { label: 'Rules', href: appRoutes.rules, exact: false },
  { label: 'Marketplace', href: appRoutes.marketplace, exact: true },
  { label: 'Proof', href: appRoutes.proof, exact: false },
  { label: 'Account', href: appRoutes.account, exact: true },
  { label: 'Cost', href: appRoutes.cost, exact: true },
] as const;

const items = legacyWorkspace ? legacyNavigation : workflowNavigation;

export function AppMobileNav() {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current]');
    if (!nav || !active) return;
    const navBox = nav.getBoundingClientRect();
    const itemBox = active.getBoundingClientRect();
    if (itemBox.right > navBox.right || itemBox.left < navBox.left) {
      nav.scrollLeft += itemBox.left - navBox.left - 16;
    }
  }, [pathname]);

  return (
    <div className="app-mobile">
      <div className="app-mobile-bar">
        <Link to={appRoutes.landing} aria-label="Rulebook home">
          <Wordmark />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <WalletControl />
          {!legacyWorkspace && <NewWorkflowLink compact />}
        </div>
      </div>
      <nav ref={navRef} aria-label="Workspace" className="app-mobile-tabs">
        {items.map((item) => {
          const active =
            'exact' in item
              ? isActiveRoute(pathname, item.href, item.exact)
              : [item.href, ...item.activeOn].some((path) => isActiveRoute(pathname, path, false));
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? (pathname === item.href ? 'page' : 'location') : undefined}
              className="app-mobile-tab"
            >
              {'shortLabel' in item ? item.shortLabel : item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
