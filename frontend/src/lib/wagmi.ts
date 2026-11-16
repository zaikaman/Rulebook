import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { createConfig, http } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import { defineChain } from 'viem';

export const lasnaChain = defineChain({
  id: LASNA_CHAIN_ID,
  name: 'Reactive Lasna',
  nativeCurrency: { name: 'Lasna REACT', symbol: 'REACT', decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_LASNA_RPC_URL ?? 'https://lasna-rpc.rnk.dev/'],
    },
  },
  blockExplorers: { default: { name: 'ReactsScan', url: 'https://reactscan.net' } },
  testnet: true,
});

export const unichainSepoliaChain = defineChain({
  id: UNICHAIN_SEPOLIA_CHAIN_ID,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_UNICHAIN_RPC_URL ?? 'https://sepolia.unichain.org'],
    },
  },
  blockExplorers: { default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' } },
  testnet: true,
});

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [lasnaChain, unichainSepoliaChain],
  connectors: [injected(), ...(projectId ? [walletConnect({ projectId })] : [])],
  transports: {
    5318007: http(import.meta.env.VITE_LASNA_RPC_URL ?? 'https://lasna-rpc.rnk.dev/'),
    1301: http(import.meta.env.VITE_UNICHAIN_RPC_URL ?? 'https://sepolia.unichain.org'),
  },
  ssr: false,
});

/** Error thrown when a write is attempted on the wrong network. */
export class WrongChainError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number | undefined,
  ) {
    super(
      `This action must be signed on chain ${expected}; the wallet is on ${actual ?? 'no chain'}`,
    );
    this.name = 'WrongChainError';
  }
}

/** Refuses a write on the wrong chain instead of silently targeting the other network. */
export function assertChain(chainId: number, expected: number): void {
  if (chainId !== expected) throw new WrongChainError(expected, chainId);
}
