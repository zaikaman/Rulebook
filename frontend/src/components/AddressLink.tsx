import { getChain } from '@rulebook/shared';

export interface AddressLinkProps {
  readonly chainId: number;
  readonly address: string;
  readonly label?: string;
}

/** Explorer link for a contract address; the host comes only from the shared chain config. */
export function AddressLink({ chainId, address, label }: AddressLinkProps) {
  const chain = getChain(chainId);
  return (
    <a
      href={`${chain.explorerUrl}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      className="app-link break-all font-mono text-xs"
      title={address}
    >
      {label ?? `${address.slice(0, 8)}…${address.slice(-6)}`}
    </a>
  );
}
