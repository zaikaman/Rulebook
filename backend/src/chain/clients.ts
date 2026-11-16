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
  id: 5_318_007,
  name: 'Reactive Lasna',
  nativeCurrency: { name: 'Lasna REACT', symbol: 'REACT', decimals: 18 },
  rpcUrls: { default: { http: ['https://lasna-rpc.rnk.dev/'] } },
  blockExplorers: { default: { name: 'ReactsScan', url: 'https://reactscan.net' } },
  testnet: true,
});

/** Unichain Sepolia, the funds network. */
export const unichainSepoliaChain: Chain = defineChain({
  id: 1301,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.unichain.org'] } },
  blockExplorers: {
    default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' },
  },
  testnet: true,
});

export interface ChainClients {
  readonly lasna: PublicClient;
  readonly unichain: PublicClient;
}

/**
 * Builds chain-scoped clients. Each transport lists the configured primary plus the documented
 * alternate endpoint, so a single flaky RPC does not stall the indexer.
 */
export function createChainClients(config: AppConfig): ChainClients {
  return {
    lasna: createPublicClient({
      chain: { ...lasnaChain, rpcUrls: { default: { http: [config.LASNA_RPC_URL] } } },
      transport: fallback([http(config.LASNA_RPC_URL), http('https://lasna-rpc.rnk.dev/')]),
    }),
    unichain: createPublicClient({
      chain: {
        ...unichainSepoliaChain,
        rpcUrls: { default: { http: [config.UNICHAIN_RPC_URL] } },
      },
      transport: fallback([http(config.UNICHAIN_RPC_URL), http('https://sepolia.unichain.org')]),
    }),
  };
}

/** Resolves the client for a chain id, or throws for an unconfigured chain. */
export function clientFor(clients: ChainClients, chainId: number): PublicClient {
  if (chainId === lasnaChain.id) return clients.lasna;
  if (chainId === unichainSepoliaChain.id) return clients.unichain;
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
