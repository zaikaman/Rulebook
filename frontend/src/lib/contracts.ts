import {
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { isAddress } from 'viem';

function configuredAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? (value.toLowerCase() as Address) : undefined;
}

/** Deployment addresses are configuration, never hard-coded chain constants. */
export const AGENT_FACTORY_ADDRESS = configuredAddress(import.meta.env.VITE_AGENT_FACTORY_ADDRESS);
export const VAULT_FACTORY_ADDRESS = configuredAddress(import.meta.env.VITE_VAULT_FACTORY_ADDRESS);

export const LASNA_CONFIG = getChain(LASNA_CHAIN_ID);
export const UNICHAIN_CONFIG = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);

/** The fixed demo pair used by onboarding and starter funds. */
export const DEMO_USDC = UNICHAIN_CONFIG.usdc;
export const DEMO_WETH = UNICHAIN_CONFIG.weth;
export const MIRROR_ENABLED = import.meta.env.VITE_ENABLE_MIRROR === 'true';
