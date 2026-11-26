import { useNetworkMode } from '@/lib/networkMode';
import { Button, Toolbar } from '@/ui';

const OPTIONS = [
  { mode: 'testnet', label: 'Testnet' },
  { mode: 'mainnet', label: 'Mainnet' },
] as const;

/** Environment switch between Testnet (default) and Mainnet deployments. */
export function NetworkModeSwitch() {
  const { mode, setMode } = useNetworkMode();

  return (
    <Toolbar role="group" aria-label="Network environment" className="app-network-switch">
      {OPTIONS.map((option) => (
        <Button
          key={option.mode}
          variant={mode === option.mode ? 'primary' : 'quiet'}
          aria-pressed={mode === option.mode}
          data-testid={`network-mode-${option.mode}`}
          onClick={() => setMode(option.mode)}
        >
          {option.label}
        </Button>
      ))}
    </Toolbar>
  );
}
