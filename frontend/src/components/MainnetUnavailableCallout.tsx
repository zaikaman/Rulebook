import { useNetworkMode } from '@/lib/networkMode';
import { Button, Callout } from '@/ui';

/** Honest empty notice when Mainnet is selected before contracts are deployed in this environment. */
export function MainnetUnavailableCallout({
  context = 'Workflow actions',
}: {
  readonly context?: string;
}) {
  const { setMode } = useNetworkMode();

  return (
    <Callout
      title="Mainnet contracts are not deployed yet"
      action={
        <Button variant="primary" onClick={() => setMode('testnet')}>
          Switch to Testnet
        </Button>
      }
    >
      <p>
        {context} requires deployed Mainnet Agent and Vault factories. Switch back to Testnet to
        build, fund, and run workflows now.
      </p>
    </Callout>
  );
}
