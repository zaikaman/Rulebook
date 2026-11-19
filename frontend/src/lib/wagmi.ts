import {
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { createConfig, http } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import { createPublicClient, defineChain, type Hex } from 'viem';

const lasna = getChain(LASNA_CHAIN_ID);
const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
const unichainWalletRpcUrl =
  import.meta.env.VITE_UNICHAIN_WALLET_RPC_URL?.trim() || unichain.rpcUrl;

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

const lasnaRpcUrl = import.meta.env.VITE_LASNA_RPC_URL ?? lasna.rpcUrl;
const unichainRpcUrl = import.meta.env.VITE_UNICHAIN_RPC_URL ?? unichain.rpcUrl;

/** Read-only clients used for setup-state and balance reads; they never sign. */
export const lasnaPublicClient = createPublicClient({
  chain: lasnaChain,
  transport: http(lasnaRpcUrl),
});

export const unichainPublicClient = createPublicClient({
  chain: unichainSepoliaChain,
  transport: http(unichainRpcUrl),
});

/** Lasna estimates for addRule need headroom for the rule storage and subscription writes. */
export async function estimateAddRuleGas(to: Address, data: Hex, account?: Address) {
  const estimate = await lasnaPublicClient.estimateGas({ to, data, account });
  return (estimate * 120n) / 100n;
}

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [lasnaChain, unichainSepoliaChain],
  connectors: [injected(), ...(projectId ? [walletConnect({ projectId })] : [])],
  transports: {
    5318007: http(lasnaRpcUrl),
    1301: http(unichainRpcUrl),
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
