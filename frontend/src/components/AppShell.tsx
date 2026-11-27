import type { ReactNode } from 'react';
import { Outlet } from 'react-router';

import { AssistantLauncher, AssistantProvider } from '../assistant/AssistantContext.js';
import { AppMobileNav } from './chrome/AppMobileNav.js';
import { AppScrollArea } from './chrome/AppScrollArea.js';
import { AppSidebar } from './chrome/AppSidebar.js';
import { AppTopbar } from './chrome/AppTopbar.js';
import { DemoModeBanner } from './DemoModeBanner.js';
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
    <AssistantProvider>
      <div className="app-shell">
        {!focused && <AppSidebar />}
        <div className="app-main">
          {!focused && <AppTopbar />}
          {!focused && <AppMobileNav />}
          <AppScrollArea>
            <div className={focused ? 'app-workspace app-workspace--focused' : 'app-workspace'}>
              <OfflineState />
              {!focused && <DemoModeBanner />}
              {children ?? <Outlet />}
              {focused && (
                <div className="app-assistant-dock">
                  <AssistantLauncher />
                </div>
              )}
            </div>
          </AppScrollArea>
        </div>
      </div>
    </AssistantProvider>
  );
}
