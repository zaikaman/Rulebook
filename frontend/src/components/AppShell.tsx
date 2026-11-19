import type { ReactNode } from 'react';
import { Outlet } from 'react-router';

import { AppMobileNav } from './chrome/AppMobileNav.js';
import { AppScrollArea } from './chrome/AppScrollArea.js';
import { AppSidebar } from './chrome/AppSidebar.js';
import { IndexerStatus } from './IndexerStatus.js';
import { OfflineState } from './OfflineState.js';
import '../styles/workspace.css';

export function AppShell({
  children,
  focused = false,
}: {
  readonly children?: ReactNode;
  readonly focused?: boolean;
}) {
  return (
    <div className="app-shell min-h-screen lg:h-screen bg-[#020202] p-3 lg:p-8 flex justify-center">
      <div className="bg-[#070707] w-full max-w-[1500px] lg:h-full rounded-[28px] lg:rounded-[40px] shadow-2xl shadow-black/50 overflow-hidden flex flex-col lg:flex-row relative border border-white/5">
        {!focused && <AppSidebar />}
        <main className="flex-1 flex flex-col min-w-0 lg:h-full bg-[#070707]">
          {!focused && <AppMobileNav />}
          <AppScrollArea>
            <div className={focused ? 'app-workspace' : 'app-workspace py-6 lg:py-8'}>
              <OfflineState />
              {!focused && <IndexerStatus />}
              {children ?? <Outlet />}
            </div>
          </AppScrollArea>
        </main>
      </div>
    </div>
  );
}
