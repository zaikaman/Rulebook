import { CHAIN_CONFIGS } from '@rulebook/shared';

export interface NetworkBadgeProps {
  readonly chainId: number;
}

/** Labels a configured network or shows the chain ID reported by an unsupported wallet. */
export function NetworkBadge({ chainId }: NetworkBadgeProps) {
  const chain = CHAIN_CONFIGS.get(chainId);
  return (
    <span data-chain-role={chain?.role} data-chain-id={chainId} className="app-network">
      {chain?.name ?? `Unsupported network (${chainId})`}
    </span>
  );
}
