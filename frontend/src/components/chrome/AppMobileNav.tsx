import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';

import { cx } from '@/lib/cx';
import { appRoutes, isActiveRoute, legacyWorkspace } from '@/lib/routes';
import { NewWorkflowLink } from './NewWorkflowLink.js';
import { WalletControl } from './WalletControl.js';
import { Wordmark } from './Wordmark.js';
import { workflowNavigation } from './workflowNavigation.js';

const legacyNavigation = [
  { label: 'Rules', href: appRoutes.rules, exact: false },
  { label: 'Create', href: appRoutes.create, exact: true },
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
    <div className="lg:hidden sticky top-0 z-30 flex flex-col border-b border-border bg-surface">
      <div
        className={cx(
          'app-mobile-header flex items-center justify-between gap-2 border-b border-border py-3',
          !legacyWorkspace && 'app-mobile-header--workflows',
        )}
      >
        <Link
          className="app-mobile-brand shrink-0"
          to={appRoutes.landing}
          aria-label="Rulebook home"
        >
          <Wordmark />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <WalletControl />
          {!legacyWorkspace && <NewWorkflowLink compact />}
        </div>
      </div>
      <nav
        ref={navRef}
        aria-label="Workspace"
        className={cx(
          'relative flex gap-1.5 overflow-x-auto no-scrollbar py-2.5',
          legacyWorkspace ? 'px-4' : 'px-2',
        )}
      >
        {items.map((item) => {
          const active =
            'exact' in item
              ? isActiveRoute(pathname, item.href, item.exact)
              : [item.href, ...item.activeOn].some((path) => isActiveRoute(pathname, path, false));
          const compactAccount = !legacyWorkspace && item.href === appRoutes.account;
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? (pathname === item.href ? 'page' : 'location') : undefined}
              aria-label={compactAccount ? item.label : undefined}
              className={cx(
                'flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border text-xs font-medium transition-colors',
                legacyWorkspace ? 'px-3' : 'flex-1 px-1',
                active
                  ? 'border-[var(--rb-control-border)] bg-[var(--rb-accent-tint)] text-[var(--rb-accent)]'
                  : 'border-transparent text-ink-muted hover:bg-surface-raised hover:text-ink',
              )}
            >
              {compactAccount ? 'Account' : item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
