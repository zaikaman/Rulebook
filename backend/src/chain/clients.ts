import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from '@rulebook/shared';
import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  type Chain,
  type PublicClient,
} from 'viem';

import type { AppConfig } from '../config.js';

/** Reactive Lasna, the automation network. */
export const lasnaChain: Chain = defineChain({
  id: LASNA_CHAIN_ID,
  name: 'Reactive Lasna',
  nativeCurrency: { name: 'Lasna REACT', symbol: 'REACT', decimals: 18 },
  rpcUrls: { default: { http: ['https://lasna-rpc.rnk.dev/'] } },
  blockExplorers: { default: { name: 'ReactsScan', url: 'https://reactscan.net' } },
  testnet: true,
});

/** Unichain Sepolia, the funds network. */
export const unichainSepoliaChain: Chain = defineChain({
  id: UNICHAIN_SEPOLIA_CHAIN_ID,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.unichain.org'] } },
  blockExplorers: {
    default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' },
  },
  testnet: true,
});

/** Base Sepolia, the funds and origin network. */
export const baseSepoliaChain: Chain = defineChain({
  id: BASE_SEPOLIA_CHAIN_ID,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
});

/** Reactive Mainnet, the production automation network. */
export const reactiveMainnetChain: Chain = defineChain({
  id: REACTIVE_MAINNET_CHAIN_ID,
  name: 'Reactive Mainnet',
  nativeCurrency: { name: 'REACT', symbol: 'REACT', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet-rpc.rnk.dev/'] } },
  blockExplorers: { default: { name: 'Reactscan', url: 'https://reactscan.net' } },
  testnet: false,
});

/** Unichain Mainnet, the production funds network. */
export const unichainMainnetChain: Chain = defineChain({
  id: UNICHAIN_MAINNET_CHAIN_ID,
  name: 'Unichain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.unichain.org'] } },
  blockExplorers: {
    default: { name: 'Uniscan', url: 'https://uniscan.xyz' },
  },
  testnet: false,
});

/** Base Mainnet, the production funds and origin network. */
export const baseMainnetChain: Chain = defineChain({
  id: BASE_MAINNET_CHAIN_ID,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.base.org'] } },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://basescan.org' },
  },
  testnet: false,
});

export interface ChainClients {
  readonly lasna: PublicClient;
  readonly unichain: PublicClient;
  readonly base?: PublicClient;
  readonly reactiveMainnet?: PublicClient;
  readonly unichainMainnet?: PublicClient;
  readonly baseMainnet?: PublicClient;
}

function createResilientClient(
  chain: Chain,
  configuredUrl: string | undefined,
  defaultUrl: string,
): PublicClient {
  const primary = configuredUrl ?? defaultUrl;
  const transports =
    primary === defaultUrl ? [http(defaultUrl)] : [http(primary), http(defaultUrl)];
  return createPublicClient({
    chain: { ...chain, rpcUrls: { default: { http: [primary] } } },
    transport: fallback(transports),
  });
}

/**
 * Builds chain-scoped clients. Each transport lists the configured primary plus the documented
 * alternate endpoint, so a single flaky RPC does not stall the indexer.
 */
export function createChainClients(config: AppConfig): ChainClients {
  return {
    lasna: createResilientClient(lasnaChain, config.LASNA_RPC_URL, 'https://lasna-rpc.rnk.dev/'),
    unichain: createResilientClient(
      unichainSepoliaChain,
      config.UNICHAIN_RPC_URL,
      'https://sepolia.unichain.org',
    ),
    base: createResilientClient(
      baseSepoliaChain,
      config.BASE_SEPOLIA_RPC_URL,
      'https://sepolia.base.org',
    ),
    reactiveMainnet: createResilientClient(
      reactiveMainnetChain,
      config.REACTIVE_MAINNET_RPC_URL,
      'https://mainnet-rpc.rnk.dev/',
    ),
    unichainMainnet: createResilientClient(
      unichainMainnetChain,
      config.UNICHAIN_MAINNET_RPC_URL,
      'https://mainnet.unichain.org',
    ),
    baseMainnet: createResilientClient(
      baseMainnetChain,
      config.BASE_MAINNET_RPC_URL,
      'https://mainnet.base.org',
    ),
  };
}

/** Resolves the client for a chain id, or throws for an unconfigured chain. */
export function clientFor(clients: ChainClients, chainId: number): PublicClient {
  if (chainId === lasnaChain.id) return clients.lasna;
  if (chainId === unichainSepoliaChain.id) return clients.unichain;
  if (chainId === baseSepoliaChain.id && clients.base) return clients.base;
  if (chainId === reactiveMainnetChain.id && clients.reactiveMainnet)
    return clients.reactiveMainnet;
  if (chainId === unichainMainnetChain.id && clients.unichainMainnet)
    return clients.unichainMainnet;
  if (chainId === baseMainnetChain.id && clients.baseMainnet) return clients.baseMainnet;
  throw new Error(`No RPC client configured for chain ${chainId}`);
}

/** True when the chain answers a `blockNumber` read. */
export async function ping(client: PublicClient): Promise<boolean> {
  try {
    await client.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}
