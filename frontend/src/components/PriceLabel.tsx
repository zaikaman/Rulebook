import { getChain } from '@rulebook/shared';

const SCALE = 10n ** 18n;

/** Formats a 1e18-scaled price with four decimals, rounding down like the contracts do. */
export function formatPrice(price: bigint): string {
  const whole = price / SCALE;
  const fraction = ((price % SCALE) * 10_000n) / SCALE;
  return `${whole}.${fraction.toString().padStart(4, '0')}`;
}

function observedLabel(observedAt: string | number | null | undefined): string {
  if (observedAt === null || observedAt === undefined) return 'not observed yet';
  const millis = typeof observedAt === 'number' ? observedAt * 1000 : Date.parse(observedAt);
  if (Number.isNaN(millis)) return String(observedAt);
  return new Date(millis).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export interface PriceLabelProps {
  /** The cached price, scaled by 1e18. */
  readonly price: bigint;
  /** When the observation that produced the price was seen. */
  readonly observedAt: string | number | null | undefined;
  /** The chain the pair lives on, labelled next to the figure. */
  readonly chainId: number;
}

/**
 * Never says "current price": every surface shows the last traded price with the time it was
 * observed (FR-020). The words are fixed here so no page can re-label it locally.
 */
export function PriceLabel({ price, observedAt, chainId }: PriceLabelProps) {
  const chain = getChain(chainId);
  return (
    <p data-price-basis="last-traded" className="text-xs text-ink-muted">
      Last traded price{' '}
      <span className="font-mono text-ink">{formatPrice(price)}</span>{' '}
      <span data-observed-at className="text-ink-muted">
        ({observedLabel(observedAt)})
      </span>{' '}
      <span className="text-ink-muted">on {chain.name}</span>
    </p>
  );
}
