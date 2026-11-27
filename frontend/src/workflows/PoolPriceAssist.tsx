import {
  applyPriceOffsetBps,
  formatPoolPriceDisplay,
  formatPoolPriceInput,
  formatRelativeToSpot,
  POOL_PRICE_OFFSET_PRESETS,
  type FundsChainId,
} from '@rulebook/shared';

import { PresetStrip, type PresetOption } from '@/ui';
import { v2Network } from './chainV2';
import { usePoolSpotPrice } from './usePoolSpotPrice';

export function PoolPriceAssist({
  chain,
  value,
  onSelect,
}: {
  readonly chain: FundsChainId;
  readonly value: string;
  readonly onSelect: (nextValue: string) => void;
}) {
  const query = usePoolSpotPrice(chain);
  const spot = query.data;
  const networkName = v2Network(chain).name;
  const trimmedValue = value.trim();

  const options: readonly PresetOption[] = POOL_PRICE_OFFSET_PRESETS.map((preset) => {
    if (!spot) {
      return {
        id: preset.label,
        label: preset.label,
        ariaLabel: `Set price to ${preset.label}`,
        active: false,
        onSelect: () => {},
      };
    }
    const adjusted = applyPriceOffsetBps(spot.price, preset.bps);
    const formattedInput = formatPoolPriceInput(adjusted);
    const formattedDisplay = formatPoolPriceDisplay(adjusted);
    return {
      id: preset.label,
      label: preset.label,
      ariaLabel:
        preset.bps === 0
          ? `Set price to spot (${formattedDisplay} USDC per WETH)`
          : `Set price to ${preset.label} from spot (${formattedDisplay} USDC per WETH)`,
      title: `${formattedDisplay} USDC per WETH`,
      active: trimmedValue === formattedInput,
      onSelect: () => onSelect(formattedInput),
    };
  });

  return (
    <PresetStrip
      label={`Spot · ${networkName}`}
      value={spot ? formatPoolPriceDisplay(spot.price) : undefined}
      unit="USDC/WETH"
      delta={spot ? formatRelativeToSpot(value, spot.price) : null}
      loading={query.isPending}
      refreshing={query.isFetching && !query.isPending}
      error={query.isError ? 'Pool price unavailable' : undefined}
      onRefresh={() => void query.refetch()}
      refreshLabel={`Refresh ${networkName} pool price`}
      groupLabel={`Quick price presets relative to ${networkName} spot`}
      options={options}
    />
  );
}
