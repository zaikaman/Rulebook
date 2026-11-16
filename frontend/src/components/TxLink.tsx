import { getChain } from '@rulebook/shared';

export interface TxLinkProps {
  readonly chainId: number;
  readonly txHash: string;
  readonly label?: string;
}

/** Builds an explorer URL from the per-chain config; no host is hard-coded here. */
export function TxLink({ chainId, txHash, label }: TxLinkProps) {
  const chain = getChain(chainId);
  const short = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
  return (
    <a
      href={`${chain.explorerUrl}/tx/${txHash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-sm text-ink underline decoration-dotted underline-offset-4"
      title={txHash}
    >
      {label ?? short}
    </a>
  );
}
