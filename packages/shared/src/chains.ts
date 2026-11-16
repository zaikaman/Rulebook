/**
 * Per-chain configuration. This is the only place a chain address may appear in the shared
 * package; components and routes read from here (Constitution III).
 */

import type { Address } from './schemas.js';

export type ChainRole = 'automation' | 'funds';

export interface ChainConfig {
  readonly chainId: number;
  readonly name: string;
  readonly role: ChainRole;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly isOrigin: boolean;
  readonly isDestination: boolean;
  readonly router: Address;
  readonly weth: Address;
  readonly usdc: Address;
  readonly pair: Address;
  readonly callbackProxy: Address;
  readonly systemContract: Address;
  readonly supportedTemplates: readonly number[];
}

export const LASNA_CHAIN_ID = 5_318_007;
export const UNICHAIN_SEPOLIA_CHAIN_ID = 1301;

const ALL_TEMPLATES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

export const CHAIN_CONFIGS: ReadonlyMap<number, ChainConfig> = new Map([
  [
    LASNA_CHAIN_ID,
    {
      chainId: LASNA_CHAIN_ID,
      name: 'Reactive Lasna',
      role: 'automation',
      rpcUrl: 'https://lasna-rpc.rnk.dev/',
      explorerUrl: 'https://reactscan.net',
      isOrigin: true,
      isDestination: false,
      router: '0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF',
      weth: '0x4200000000000000000000000000000000000006',
      usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
      pair: '0x1d8698365321D6DcE1F7141c380C866b012eE9dA',
      callbackProxy: '0x775c9B990ADe401060B78D0e98684eEf8d2466C1',
      systemContract: '0x8888888888888888888888888888888888888888',
      supportedTemplates: ALL_TEMPLATES,
    },
  ],
  [
    UNICHAIN_SEPOLIA_CHAIN_ID,
    {
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      name: 'Unichain Sepolia',
      role: 'funds',
      rpcUrl: 'https://sepolia.unichain.org',
      explorerUrl: 'https://sepolia.uniscan.xyz',
      isOrigin: false,
      isDestination: true,
      router: '0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF',
      weth: '0x4200000000000000000000000000000000000006',
      usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
      pair: '0x1d8698365321D6DcE1F7141c380C866b012eE9dA',
      callbackProxy: '0x775c9B990ADe401060B78D0e98684eEf8d2466C1',
      systemContract: '0x8888888888888888888888888888888888888888',
      supportedTemplates: ALL_TEMPLATES,
    },
  ],
]);

export const SUPPORTED_CHAIN_IDS = [LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID] as const;

/** Error thrown for a chain this release does not configure. */
export class UnsupportedChainError extends Error {
  constructor(readonly chainId: number) {
    super(`Unsupported chain ${chainId}: only ${SUPPORTED_CHAIN_IDS.join(', ')} are configured`);
    this.name = 'UnsupportedChainError';
  }
}

/** Returns the configuration for `chainId`, or throws `UnsupportedChainError`. */
export function getChain(chainId: number): ChainConfig {
  const chain = CHAIN_CONFIGS.get(chainId);
  if (!chain) throw new UnsupportedChainError(chainId);
  return chain;
}

/** Returns the templates the given chain can express, filtered by its config. */
export function supportedTemplatesFor(chainId: number): readonly number[] {
  return getChain(chainId).supportedTemplates;
}
