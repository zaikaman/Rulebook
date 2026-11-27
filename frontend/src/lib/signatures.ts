import type { Address, SupportedChainId } from '@rulebook/shared';

export interface SignatureDetails {
  readonly chainId: SupportedChainId;
  readonly target: Address;
  readonly targetLabel: string;
  readonly effect: string;
  readonly amount: string;
  readonly amountLabel?: string;
  readonly offChain?: boolean;
}
