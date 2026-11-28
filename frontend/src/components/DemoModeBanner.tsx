import { useDemoMode } from '@/lib/demoMode';
import { Badge, Button, Panel } from '@/ui';
import { CopyButton } from './chrome/CopyButton.js';
import { WalletControl } from './chrome/WalletControl.js';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Persistent workspace banner shown while inspecting the read-only testnet demo account. */
export function DemoModeBanner() {
  const { isDemoMode, demoOwner, exitDemoMode } = useDemoMode();

  if (!isDemoMode || !demoOwner) return null;

  return (
    <Panel className="app-demo-banner" role="region" aria-label="Demo account mode">
      <div className="app-demo-banner__copy">
        <div className="app-demo-banner__meta">
          <Badge tone="info">Demo account · Read-only</Badge>
          <span className="app-demo-banner__address" title={demoOwner}>
            <code>{shortAddress(demoOwner)}</code>
            <CopyButton value={demoOwner} label="demo account address" />
          </span>
        </div>
        <p>View live testnet workflows, health, run history, and Vault balances.</p>
      </div>
      <div className="app-demo-banner__actions">
        <WalletControl />
        <Button variant="quiet" onClick={exitDemoMode}>
          Exit demo
        </Button>
      </div>
    </Panel>
  );
}
