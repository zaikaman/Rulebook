import { cx } from '@/lib/cx';
import { useNetworkMode } from '@/lib/networkMode';
import { Button, Toolbar } from '@/ui';

const OPTIONS = [
  { mode: 'testnet', label: 'Testnet' },
  { mode: 'mainnet', label: 'Mainnet' },
] as const;

export interface NetworkModeSwitchProps {
  readonly compact?: boolean;
  readonly testIdPrefix?: string;
}

/** Environment switch between Testnet (default) and Mainnet deployments. */
export function NetworkModeSwitch({
  compact = false,
  testIdPrefix = 'network-mode',
}: NetworkModeSwitchProps) {
  const { mode, setMode } = useNetworkMode();

  return (
    <Toolbar
      role="group"
      aria-label="Network environment"
      data-network-mode={mode}
      className={cx('app-network-switch', compact && 'app-network-switch--compact')}
    >
      {OPTIONS.map((option) => (
        <Button
          key={option.mode}
          variant={mode === option.mode ? 'primary' : 'quiet'}
          aria-pressed={mode === option.mode}
          data-testid={`${testIdPrefix}-${option.mode}`}
          onClick={() => setMode(option.mode)}
        >
          {option.label}
        </Button>
      ))}
    </Toolbar>
  );
}
