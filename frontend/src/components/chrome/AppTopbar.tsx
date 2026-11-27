import { SparklesIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useLocation } from 'react-router';
import { Link } from 'react-router';

import { useAssistant } from '@/assistant/AssistantContext';
import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { appRoutes } from '@/lib/routes';
import { Badge, Button } from '@/ui';
import { NetworkModeSwitch } from './NetworkModeSwitch.js';
import { WalletControl } from './WalletControl.js';

function pageLabel(pathname: string): string {
  if (pathname === appRoutes.newWorkflow) return 'New workflow';
  if (/^\/workflows\/[^/]+\/edit$/.test(pathname)) return 'Edit workflow';
  if (/^\/workflows\/[^/]+$/.test(pathname)) return 'Workflow';
  if (pathname === appRoutes.workflows) return 'Workflows';
  if (pathname === appRoutes.activity) return 'Activity';
  if (pathname.startsWith(`${appRoutes.runs}/`)) return 'Workflow proof';
  if (/^\/marketplace\/[^/]+$/.test(pathname)) return 'Listing';
  if (pathname === appRoutes.marketplace) return 'Marketplace';
  if (pathname === appRoutes.account || pathname === appRoutes.accountFunds)
    return 'Account & Vault';
  if (pathname.startsWith(appRoutes.proof)) return 'Workflow proof';
  if (pathname === appRoutes.cost) return 'Workflow costs';
  return 'Workspace';
}

export function AppTopbar() {
  const { pathname } = useLocation();
  const assistant = useAssistant();
  const { mode, automationName, isDeploymentConfigured } = useNetworkMode();

  return (
    <header className="app-topbar">
      <nav aria-label="Workspace breadcrumb" className="app-crumb">
        <Link to={withNetworkQuery(appRoutes.workflows, mode)}>Workspace</Link>
        <span className="app-crumb-sep" aria-hidden="true">
          /
        </span>
        <strong>{pageLabel(pathname)}</strong>
      </nav>

      <div className="app-topbar-actions">
        {' '}
        <NetworkModeSwitch />
        <Button
          variant="quiet"
          className="app-assistant-topbar-trigger"
          aria-label="Ask Bookkeeper"
          onClick={assistant.open}
        >
          <HugeiconsIcon icon={SparklesIcon} size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="app-assistant-topbar-label">Ask Bookkeeper</span>
        </Button>
        <Badge plain data-testid="active-automation-network">
          {isDeploymentConfigured && <span className="app-live-dot" aria-hidden="true" />}
          {automationName}
        </Badge>
        <WalletControl />
      </div>
    </header>
  );
}
