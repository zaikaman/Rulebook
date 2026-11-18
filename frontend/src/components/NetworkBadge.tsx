import { CHAIN_CONFIGS } from '@rulebook/shared';

export interface NetworkBadgeProps {
  readonly chainId: number;
}

/** Labels a configured network or shows the chain ID reported by an unsupported wallet. */
export function NetworkBadge({ chainId }: NetworkBadgeProps) {
  const chain = CHAIN_CONFIGS.get(chainId);
  const tone =
    chain?.role === 'automation'
      ? 'border-automation text-automation'
      : chain?.role === 'funds'
        ? 'border-funds text-funds'
        : 'border-border text-ink-muted';

  return (
    <span
      data-chain-role={chain?.role}
      data-chain-id={chainId}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {chain?.name ?? `Unsupported network (${chainId})`}
    </span>
  );
}
