import type { ComponentProps } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link, useLocation } from 'react-router';
import { cx } from '@/lib/cx';
import { isActiveRoute, type AppHref } from '@/lib/routes';

export interface TreeChild {
  readonly label: string;
  readonly href: AppHref | string;
}

export function SidebarSection({
  label,
  href,
  icon,
  items = [],
  nested = false,
}: {
  readonly label: string;
  readonly href: AppHref | string;
  readonly icon: ComponentProps<typeof HugeiconsIcon>['icon'];
  readonly items?: readonly TreeChild[];
  readonly nested?: boolean;
}) {
  const { pathname } = useLocation();
  const sectionActive =
    isActiveRoute(pathname, href, !nested) || items.some((item) => item.href === pathname);

  return (
    <div className="pt-2">
      <Link
        to={href}
        aria-current={pathname === href ? 'page' : undefined}
        data-active={sectionActive || undefined}
        className="app-nav-link flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-ink-muted transition-colors"
      >
        <HugeiconsIcon
          icon={icon}
          size={16}
          className={sectionActive ? 'text-[var(--rb-accent)]' : ''}
          aria-hidden="true"
        />
        <span className="text-sm font-medium">{label}</span>
      </Link>
      {items.length > 0 && (
        <div className="relative ml-5 pl-4 pt-1 space-y-1">
          <div className="absolute left-[3px] top-0 bottom-4 w-px bg-white/10" />
          {items.map((item, index) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'relative flex items-center gap-3 px-3 py-2 transition-colors rounded-lg',
                  active ? 'text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                <div
                  className={cx(
                    'w-4 border-white/10 rounded-bl-xl border-b border-l absolute left-[-13px]',
                    index === 0 ? 'h-[50%] top-0' : 'h-[100%] top-[-50%]',
                  )}
                />
                {active && (
                  <span
                    className="absolute left-0 h-1 w-1 rounded-full bg-[var(--rb-accent)]"
                    aria-hidden="true"
                  />
                )}
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
