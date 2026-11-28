import { BASE_SEPOLIA_CHAIN_ID, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';

import { BASE_CONFIG, LASNA_CONFIG, UNICHAIN_CONFIG } from './contracts.js';

export const testnetTokens = {
  react: {
    symbol: 'lREACT',
    network: LASNA_CONFIG,
    faucet: 'https://dev.reactive.network/reactive-mainnet#get-testnet-react',
    linkLabel: 'Get Lasna lREACT',
    instructions: 'Start with test ETH on Ethereum Sepolia or Base Sepolia.',
  },
  eth: {
    symbol: 'ETH',
    network: UNICHAIN_CONFIG,
    faucet: 'https://console.optimism.io/faucet',
    linkLabel: 'Get Unichain Sepolia ETH',
    instructions: 'Choose Unichain Sepolia in the Superchain Faucet.',
  },
  usdc: {
    symbol: 'USDC',
    network: UNICHAIN_CONFIG,
    faucet: 'https://faucet.circle.com/',
    linkLabel: 'Get Unichain Sepolia USDC',
    instructions: 'Choose USDC and Unichain Sepolia in the Circle faucet.',
  },
  baseEth: {
    symbol: 'ETH',
    network: BASE_CONFIG,
    faucet: 'https://console.optimism.io/faucet',
    linkLabel: 'Get Base Sepolia ETH',
    instructions: 'Choose Base Sepolia in the Superchain Faucet or Coinbase Developer faucet.',
  },
  baseUsdc: {
    symbol: 'USDC',
    network: BASE_CONFIG,
    faucet: 'https://faucet.circle.com/',
    linkLabel: 'Get Base Sepolia USDC',
    instructions: 'Choose USDC and Base Sepolia in the Circle faucet.',
  },
} as const;

export type TestnetFaucetInfo = (typeof testnetTokens)[keyof typeof testnetTokens];

/** Native/credit testnet faucet for `chainId`, or `undefined` on mainnet/unsupported chains. */
export function creditFaucetFor(chainId: number): TestnetFaucetInfo | undefined {
  if (chainId === LASNA_CHAIN_ID) return testnetTokens.react;
  if (chainId === UNICHAIN_SEPOLIA_CHAIN_ID) return testnetTokens.eth;
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return testnetTokens.baseEth;
  return undefined;
}

/** Testnet USDC faucet for `chainId`, or `undefined` on mainnet/unsupported chains. */
export function usdcFaucetFor(chainId: number): TestnetFaucetInfo | undefined {
  if (chainId === UNICHAIN_SEPOLIA_CHAIN_ID) return testnetTokens.usdc;
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return testnetTokens.baseUsdc;
  return undefined;
}

/** Ordered list of testnet faucets (automation credit, settlement credit, settlement USDC) for a funds chain. */
export function testnetFaucetsFor(fundsChainId: number): readonly TestnetFaucetInfo[] {
  const ethFaucet = creditFaucetFor(fundsChainId);
  const usdcFaucet = usdcFaucetFor(fundsChainId);
  if (!ethFaucet || !usdcFaucet) return [];
  return [testnetTokens.react, ethFaucet, usdcFaucet];
}
