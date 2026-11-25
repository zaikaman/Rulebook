import {
  BASE_SEPOLIA_CHAIN_ID,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from '@rulebook/shared';

export const LASNA_CONFIG = getChain(LASNA_CHAIN_ID);
export const UNICHAIN_CONFIG = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
export const BASE_CONFIG = getChain(BASE_SEPOLIA_CHAIN_ID);

/** The supported testnet pair for account setup and wallet deposits. */
export const DEMO_USDC = UNICHAIN_CONFIG.usdc;
export const DEMO_WETH = UNICHAIN_CONFIG.weth;
