import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID, type Address } from '@rulebook/shared';

export interface SignatureDetails {
  readonly chainId: typeof LASNA_CHAIN_ID | typeof UNICHAIN_SEPOLIA_CHAIN_ID;
  readonly target: Address;
  readonly targetLabel: string;
  readonly effect: string;
  readonly amount: string;
  readonly amountLabel?: string;
}
