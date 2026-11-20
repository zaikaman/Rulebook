import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';

import { cx } from '@/lib/cx';
import { appRoutes, isActiveRoute, legacyWorkspace } from '@/lib/routes';
import { WalletControl } from './WalletControl.js';
import { Wordmark } from './Wordmark.js';

const items = [
  {
    label: legacyWorkspace ? 'Rules' : 'Workflows',
    href: legacyWorkspace ? appRoutes.rules : appRoutes.workflows,
    exact: false,
  },
  {
    label: 'Create',
    href: legacyWorkspace ? appRoutes.create : appRoutes.newWorkflow,
    exact: true,
  },
  { label: 'Marketplace', href: appRoutes.marketplace, exact: true },
  ...(legacyWorkspace ? [{ label: 'Proof', href: appRoutes.proof, exact: false }] : []),
  { label: 'Account', href: appRoutes.account, exact: true },
  ...(legacyWorkspace ? [{ label: 'Cost', href: appRoutes.cost, exact: true }] : []),
] as const;

export function AppMobileNav() {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const navBox = nav.getBoundingClientRect();
    const itemBox = active.getBoundingClientRect();
    if (itemBox.right > navBox.right || itemBox.left < navBox.left) {
      nav.scrollLeft += itemBox.left - navBox.left - 16;
    }
  }, [pathname]);

  return (
    <div className="lg:hidden sticky top-0 z-30 flex flex-col border-b border-border bg-surface">
      <div className="app-mobile-header flex items-center justify-between gap-2 border-b border-border py-3">
        <Link to={appRoutes.landing}>
          <Wordmark />
        </Link>
        <WalletControl />
      </div>
      <nav
        ref={navRef}
        aria-label="Workspace"
        className="relative flex gap-1.5 overflow-x-auto no-scrollbar px-4 py-2.5"
      >
        {items.map((item) => {
          const active = isActiveRoute(pathname, item.href, item.exact);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex min-h-9 shrink-0 items-center rounded-lg border px-3 text-xs font-medium transition-colors',
                active
                  ? 'border-[var(--rb-control-border)] bg-[var(--rb-accent-tint)] text-[var(--rb-accent)]'
                  : 'border-transparent text-ink-muted hover:bg-surface-raised hover:text-ink',
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
