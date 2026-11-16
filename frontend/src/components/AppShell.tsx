import type { ReactNode } from 'react';
import { Outlet } from 'react-router';

import { AppMobileNav } from './chrome/AppMobileNav.js';
import { AppScrollArea } from './chrome/AppScrollArea.js';
import { AppSidebar } from './chrome/AppSidebar.js';

export function AppShell({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="min-h-screen lg:h-screen bg-[#020202] p-3 lg:p-8 flex justify-center">
      <div className="bg-[#070707] w-full max-w-[1500px] lg:h-full rounded-[28px] lg:rounded-[40px] shadow-2xl shadow-black/50 overflow-hidden flex flex-col lg:flex-row relative border border-white/5">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-w-0 lg:h-full bg-[#070707]">
          <AppMobileNav />
          <AppScrollArea>
            <div className="py-6 lg:py-8">
              {children ?? <Outlet />}
            </div>
          </AppScrollArea>
        </main>
      </div>
    </div>
  );
}
