import { LASNA_CONFIG, UNICHAIN_CONFIG } from './contracts.js';

export const testnetTokens = {
  react: {
    symbol: 'REACT',
    network: LASNA_CONFIG,
    faucet: 'https://dev.reactive.network/reactive-mainnet#get-testnet-react',
    linkLabel: 'Get Lasna REACT',
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
} as const;
