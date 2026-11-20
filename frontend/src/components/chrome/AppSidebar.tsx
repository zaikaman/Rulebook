import {
  ArrowLeft01Icon,
  Book02Icon,
  Coins01Icon,
  DocumentValidationIcon,
  Store01Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from 'react-router';

import { appRoutes, legacyWorkspace } from '@/lib/routes';
import { NewWorkflowLink } from './NewWorkflowLink.js';
import { SidebarSection } from './SidebarSection.js';
import { WalletControl } from './WalletControl.js';
import { Wordmark } from './Wordmark.js';
import { workflowNavigation } from './workflowNavigation.js';

export function AppSidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-72 shrink-0 h-full p-8 border-r border-white/5 bg-[#070707] overflow-y-auto no-scrollbar">
      <Link
        to={appRoutes.landing}
        aria-label="Rulebook home"
        className="flex items-center gap-2 mb-8 pl-2"
      >
        <Wordmark />
      </Link>

      {!legacyWorkspace && (
        <div className="pb-4">
          <NewWorkflowLink />
        </div>
      )}
      <nav aria-label="Workspace" className="flex-1">
        {legacyWorkspace ? (
          <>
            <SidebarSection
              label="Rules"
              href={appRoutes.rules}
              icon={Book02Icon}
              nested
              items={[{ label: 'Compose sentence', href: appRoutes.create }]}
            />
            <SidebarSection label="Marketplace" href={appRoutes.marketplace} icon={Store01Icon} />
            <SidebarSection
              label="Proof Explorer"
              href={appRoutes.proof}
              icon={DocumentValidationIcon}
              nested
            />
            <SidebarSection label="Account & Vault" href={appRoutes.account} icon={Wallet01Icon} />
            <SidebarSection label="Cost Model" href={appRoutes.cost} icon={Coins01Icon} />
          </>
        ) : (
          workflowNavigation.map((item) => <SidebarSection key={item.href} {...item} nested />)
        )}
      </nav>

      <div className="app-divider mt-auto space-y-4 pt-6">
        <WalletControl />

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
