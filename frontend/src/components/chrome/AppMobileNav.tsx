import { SparklesIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';

import { useAssistant } from '@/assistant/AssistantContext';
import { appRoutes, isActiveRoute } from '@/lib/routes';
import { Button } from '@/ui';
import { NewWorkflowLink } from './NewWorkflowLink.js';
import { WalletControl } from './WalletControl.js';
import { Wordmark } from './Wordmark.js';
import { workflowNavigation } from './workflowNavigation.js';

const items = workflowNavigation;

export function AppMobileNav() {
  const { pathname } = useLocation();
  const assistant = useAssistant();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current]');
    if (!nav || !active) return;
    const frame = requestAnimationFrame(() => {
      const navBox = nav.getBoundingClientRect();
      const itemBox = active.getBoundingClientRect();
      if (itemBox.left >= navBox.left + 16 && itemBox.right <= navBox.right - 16) return;
      const target =
        nav.scrollLeft + itemBox.left - navBox.left - (navBox.width - itemBox.width) / 2;
      nav.scrollLeft = Math.min(Math.max(target, 0), nav.scrollWidth - nav.clientWidth);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <div className="app-mobile">
      <div className="app-mobile-bar">
        <Link to={appRoutes.landing} aria-label="Rulebook home">
          <Wordmark />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="quiet"
            className="app-icon-button"
            aria-label="Ask Bookkeeper"
            onClick={assistant.open}
          >
            <HugeiconsIcon icon={SparklesIcon} size={17} strokeWidth={1.8} aria-hidden="true" />
          </Button>
          <WalletControl />
          <NewWorkflowLink compact />
        </div>
      </div>
      <nav ref={navRef} aria-label="Workspace" className="app-mobile-tabs">
        {items.map((item) => {
          const active = [item.href, ...item.activeOn].some((path) =>
            isActiveRoute(pathname, path, false),
          );
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
