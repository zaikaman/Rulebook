import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  getChain,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { createConfig, http } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import { createPublicClient, defineChain, type Hex } from 'viem';

const lasna = getChain(LASNA_CHAIN_ID);
const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
const base = getChain(BASE_SEPOLIA_CHAIN_ID);
const reactiveMainnet = getChain(REACTIVE_MAINNET_CHAIN_ID);
const unichainMainnet = getChain(UNICHAIN_MAINNET_CHAIN_ID);
const baseMainnet = getChain(BASE_MAINNET_CHAIN_ID);

const unichainWalletRpcUrl =
  import.meta.env.VITE_UNICHAIN_WALLET_RPC_URL?.trim() || unichain.rpcUrl;
const baseWalletRpcUrl = import.meta.env.VITE_BASE_SEPOLIA_WALLET_RPC_URL?.trim() || base.rpcUrl;
const reactiveMainnetWalletRpcUrl =
  import.meta.env.VITE_REACTIVE_MAINNET_WALLET_RPC_URL?.trim() || reactiveMainnet.rpcUrl;
const unichainMainnetWalletRpcUrl =
  import.meta.env.VITE_UNICHAIN_MAINNET_WALLET_RPC_URL?.trim() || unichainMainnet.rpcUrl;
const baseMainnetWalletRpcUrl =
  import.meta.env.VITE_BASE_MAINNET_WALLET_RPC_URL?.trim() || baseMainnet.rpcUrl;

export const lasnaChain = defineChain({
  id: lasna.chainId,
  name: lasna.name,
  nativeCurrency: { name: 'Lasna REACT', symbol: 'lREACT', decimals: 18 },
  rpcUrls: { default: { http: [lasna.rpcUrl] } },
  blockExplorers: { default: { name: 'Reactscan', url: lasna.explorerUrl } },
  testnet: true,
});

export const unichainSepoliaChain = defineChain({
  id: unichain.chainId,
  name: unichain.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [unichainWalletRpcUrl] } },
  blockExplorers: { default: { name: 'Uniscan', url: unichain.explorerUrl } },
  testnet: true,
});

export const baseSepoliaChain = defineChain({
  id: base.chainId,
  name: base.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [baseWalletRpcUrl] } },
  blockExplorers: { default: { name: 'BaseScan', url: base.explorerUrl } },
  testnet: true,
});

export const reactiveMainnetChain = defineChain({
  id: reactiveMainnet.chainId,
  name: reactiveMainnet.name,
  nativeCurrency: { name: 'REACT', symbol: 'REACT', decimals: 18 },
  rpcUrls: { default: { http: [reactiveMainnetWalletRpcUrl] } },
  blockExplorers: { default: { name: 'Reactscan', url: reactiveMainnet.explorerUrl } },
  testnet: false,
});

export const unichainMainnetChain = defineChain({
  id: unichainMainnet.chainId,
  name: unichainMainnet.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [unichainMainnetWalletRpcUrl] } },
  blockExplorers: { default: { name: 'Uniscan', url: unichainMainnet.explorerUrl } },
  testnet: false,
});

export const baseMainnetChain = defineChain({
  id: baseMainnet.chainId,
  name: baseMainnet.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [baseMainnetWalletRpcUrl] } },
  blockExplorers: { default: { name: 'BaseScan', url: baseMainnet.explorerUrl } },
  testnet: false,
});

const lasnaRpcUrl = import.meta.env.VITE_LASNA_RPC_URL ?? lasna.rpcUrl;
const unichainRpcUrl = import.meta.env.VITE_UNICHAIN_RPC_URL ?? unichain.rpcUrl;
const baseRpcUrl = import.meta.env.VITE_BASE_SEPOLIA_RPC_URL ?? base.rpcUrl;
const reactiveMainnetRpcUrl =
  import.meta.env.VITE_REACTIVE_MAINNET_RPC_URL ?? reactiveMainnet.rpcUrl;
const unichainMainnetRpcUrl =
  import.meta.env.VITE_UNICHAIN_MAINNET_RPC_URL ?? unichainMainnet.rpcUrl;
const baseMainnetRpcUrl = import.meta.env.VITE_BASE_MAINNET_RPC_URL ?? baseMainnet.rpcUrl;

/** Read-only clients used for setup-state and balance reads; they never sign. */
export const lasnaPublicClient = createPublicClient({
  chain: lasnaChain,
  transport: http(lasnaRpcUrl),
});

export const unichainPublicClient = createPublicClient({
  chain: unichainSepoliaChain,
  transport: http(unichainRpcUrl),
});

export const basePublicClient = createPublicClient({
  chain: baseSepoliaChain,
  transport: http(baseRpcUrl),
});

export const reactiveMainnetPublicClient = createPublicClient({
  chain: reactiveMainnetChain,
  transport: http(reactiveMainnetRpcUrl),
});

export const unichainMainnetPublicClient = createPublicClient({
  chain: unichainMainnetChain,
  transport: http(unichainMainnetRpcUrl),
});

export const baseMainnetPublicClient = createPublicClient({
  chain: baseMainnetChain,
  transport: http(baseMainnetRpcUrl),
});

/** Resolves the read-only client for a supported chain id. */
export function publicClientFor(chainId: number) {
  if (chainId === LASNA_CHAIN_ID) return lasnaPublicClient;
  if (chainId === UNICHAIN_SEPOLIA_CHAIN_ID) return unichainPublicClient;
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return basePublicClient;
  if (chainId === REACTIVE_MAINNET_CHAIN_ID) return reactiveMainnetPublicClient;
  if (chainId === UNICHAIN_MAINNET_CHAIN_ID) return unichainMainnetPublicClient;
  if (chainId === BASE_MAINNET_CHAIN_ID) return baseMainnetPublicClient;
  throw new Error(`No public RPC client configured for chain ${chainId}`);
}

/** Reactive estimates for addRule need headroom for the rule storage and subscription writes. */
export async function estimateAddRuleGas(to: Address, data: Hex, account?: Address) {
  const estimate = await lasnaPublicClient.estimateGas({ to, data, account });
  return (estimate * 120n) / 100n;
}

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [
    lasnaChain,
    unichainSepoliaChain,
    baseSepoliaChain,
    reactiveMainnetChain,
    unichainMainnetChain,
    baseMainnetChain,
  ],
  connectors: [injected(), ...(projectId ? [walletConnect({ projectId })] : [])],
  transports: {
    [LASNA_CHAIN_ID]: http(lasnaRpcUrl),
    [UNICHAIN_SEPOLIA_CHAIN_ID]: http(unichainRpcUrl),
    [BASE_SEPOLIA_CHAIN_ID]: http(baseRpcUrl),
    [REACTIVE_MAINNET_CHAIN_ID]: http(reactiveMainnetRpcUrl),
    [UNICHAIN_MAINNET_CHAIN_ID]: http(unichainMainnetRpcUrl),
    [BASE_MAINNET_CHAIN_ID]: http(baseMainnetRpcUrl),
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
