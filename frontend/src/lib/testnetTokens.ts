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
