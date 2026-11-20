import type { ReactNode } from 'react';
import { Outlet } from 'react-router';

import { AppMobileNav } from './chrome/AppMobileNav.js';
import { AppScrollArea } from './chrome/AppScrollArea.js';
import { AppSidebar } from './chrome/AppSidebar.js';
import { AppTopbar } from './chrome/AppTopbar.js';
import { IndexerStatus } from './IndexerStatus.js';
import { OfflineState } from './OfflineState.js';
import { legacyWorkspace } from '../lib/routes.js';
import '../styles/workspace.css';

export function AppShell({
  children,
  focused = false,
}: {
  readonly children?: ReactNode;
  readonly focused?: boolean;
}) {
  return (
    <div className="app-shell">
      {!focused && <AppSidebar />}
      <div className="app-main">
        {!focused && <AppTopbar />}
        {!focused && <AppMobileNav />}
        <AppScrollArea>
          <div className={focused ? 'app-workspace app-workspace--focused' : 'app-workspace'}>
            <OfflineState />
            {!focused && legacyWorkspace && <IndexerStatus />}
            {children ?? <Outlet />}
          </div>
        </AppScrollArea>
      </div>
    </div>
  );
}
