import { useLocation } from 'react-router';
import { Link } from 'react-router';

import { appRoutes } from '@/lib/routes';
import { WalletControl } from './WalletControl.js';

function pageLabel(pathname: string): string {
  if (pathname === appRoutes.newWorkflow) return 'New workflow';
  if (/^\/workflows\/[^/]+\/edit$/.test(pathname)) return 'Edit workflow';
  if (/^\/workflows\/[^/]+$/.test(pathname)) return 'Workflow';
  if (pathname === appRoutes.workflows) return 'Workflows';
  if (pathname === appRoutes.activity || pathname.startsWith(`${appRoutes.runs}/`)) {
    return 'Activity';
  }
  if (/^\/marketplace\/[^/]+$/.test(pathname)) return 'Listing';
  if (pathname === appRoutes.marketplace) return 'Marketplace';
  if (pathname === appRoutes.account) return 'Account & Vault';
  if (pathname.startsWith(appRoutes.proof)) return 'Proof Explorer';
  if (pathname === appRoutes.cost) return 'Cost Model';
  if (pathname.startsWith(appRoutes.rules)) return 'Rules';
  return 'Workspace';
}

export function AppTopbar() {
  const { pathname } = useLocation();

  return (
    <header className="app-topbar">
      <nav aria-label="Breadcrumb" className="app-crumb">
        <Link to={appRoutes.workflows}>Workspace</Link>
        <span className="app-crumb-sep" aria-hidden="true">
          /
        </span>
        <strong>{pageLabel(pathname)}</strong>
      </nav>

      <div className="app-topbar-actions">
        <span className="rb-chip rb-chip--plain">
          <span className="app-live-dot" aria-hidden="true" />
          Reactive Lasna
        </span>
        <WalletControl />
      </div>
    </header>
  );
}
