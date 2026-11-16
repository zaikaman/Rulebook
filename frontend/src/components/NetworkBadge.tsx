import { getChain } from '@rulebook/shared';

export interface NetworkBadgeProps {
  readonly chainId: number;
}

/** Names the network a signature belongs to. Labels come only from the shared chain config. */
export function NetworkBadge({ chainId }: NetworkBadgeProps) {
  const chain = getChain(chainId);
  return (
    <span
      data-chain-role={chain.role}
      data-chain-id={chain.chainId}
      className={
        chain.role === 'automation'
          ? 'inline-flex items-center rounded-full border border-automation px-2 py-0.5 text-xs font-medium text-automation'
          : 'inline-flex items-center rounded-full border border-funds px-2 py-0.5 text-xs font-medium text-funds'
      }
    >
      {chain.name}
    </span>
  );
}
