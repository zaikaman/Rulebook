/**
 * Per-chain configuration. This is the only place a chain address may appear in the shared
 * package; components and routes read from here (Constitution III).
 */

import type { Address } from './schemas.js';

export type ChainRole = 'automation' | 'funds';
export type NetworkMode = 'testnet' | 'mainnet';
export const NETWORK_MODES = ['testnet', 'mainnet'] as const;

export interface ChainConfigBase {
  readonly chainId: number;
  readonly name: string;
  readonly network: NetworkMode;
  readonly nativeSymbol: 'lREACT' | 'REACT' | 'ETH';
  readonly role: ChainRole;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly isOrigin: boolean;
  readonly isDestination: boolean;
  readonly supportedTemplates: readonly number[];
}

export interface AutomationChainConfig extends ChainConfigBase {
  readonly role: 'automation';
  readonly isDestination: false;
  readonly systemContract: Address;
}

export interface FundsChainConfig extends ChainConfigBase {
  readonly role: 'funds';
  readonly isDestination: true;
  readonly router: Address;
  readonly weth: Address;
  readonly usdc: Address;
  readonly pair: Address;
  readonly poolFee?: number;
  readonly callbackProxy: Address;
  readonly ethUsdFeed?: Address;
  readonly usdcUsdFeed?: Address;
  readonly sequencerFeed?: Address;
}

export type ChainConfig = AutomationChainConfig | FundsChainConfig;

export const LASNA_CHAIN_ID = 5_318_007;
export const UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
export const BASE_SEPOLIA_CHAIN_ID = 84_532;
export const REACTIVE_MAINNET_CHAIN_ID = 1597;
export const UNICHAIN_MAINNET_CHAIN_ID = 130;
export const BASE_MAINNET_CHAIN_ID = 8453;

export const AUTOMATION_CHAIN_IDS = [LASNA_CHAIN_ID, REACTIVE_MAINNET_CHAIN_ID] as const;
export type AutomationChainId = (typeof AUTOMATION_CHAIN_IDS)[number];

export const TESTNET_FUNDS_CHAIN_IDS = [UNICHAIN_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID] as const;
export const MAINNET_FUNDS_CHAIN_IDS = [UNICHAIN_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID] as const;
export const FUNDS_CHAIN_IDS = [
  UNICHAIN_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
] as const;
export type FundsChainId = (typeof FUNDS_CHAIN_IDS)[number];

export function isAutomationChain(chainId: number): chainId is AutomationChainId {
  return chainId === LASNA_CHAIN_ID || chainId === REACTIVE_MAINNET_CHAIN_ID;
}

export function isFundsChain(chainId: number): chainId is FundsChainId {
  return (
    chainId === UNICHAIN_SEPOLIA_CHAIN_ID ||
    chainId === BASE_SEPOLIA_CHAIN_ID ||
    chainId === UNICHAIN_MAINNET_CHAIN_ID ||
    chainId === BASE_MAINNET_CHAIN_ID
  );
}

const ALL_TEMPLATES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

export const CHAIN_CONFIGS: ReadonlyMap<number, ChainConfig> = new Map([
  [
    LASNA_CHAIN_ID,
    {
      chainId: LASNA_CHAIN_ID,
      name: 'Reactive Lasna',
      network: 'testnet',
      nativeSymbol: 'lREACT',
      role: 'automation',
      rpcUrl: 'https://lasna-rpc.rnk.dev/',
      explorerUrl: 'https://lasna.reactscan.net',
      isOrigin: true,
      isDestination: false,
      systemContract: '0x8888888888888888888888888888888888888888',
      supportedTemplates: ALL_TEMPLATES,
    },
  ],
  [
    REACTIVE_MAINNET_CHAIN_ID,
    {
      chainId: REACTIVE_MAINNET_CHAIN_ID,
      name: 'Reactive Mainnet',
      network: 'mainnet',
      nativeSymbol: 'REACT',
      role: 'automation',
      rpcUrl: 'https://mainnet-rpc.rnk.dev/',
      explorerUrl: 'https://reactscan.net',
      isOrigin: true,
      isDestination: false,
      systemContract: '0x8888888888888888888888888888888888888888',
      supportedTemplates: ALL_TEMPLATES,
    },
  ],
  [
    UNICHAIN_SEPOLIA_CHAIN_ID,
    {
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      name: 'Unichain Sepolia',
      network: 'testnet',
      nativeSymbol: 'ETH',
      role: 'funds',
      rpcUrl: 'https://sepolia.unichain.org',
      explorerUrl: 'https://sepolia.uniscan.xyz',
      isOrigin: true,
      isDestination: true,
      router: '0x6e8C9D62A16419357eA998229126D2fD6B1CCfbF',
      weth: '0x4200000000000000000000000000000000000006',
      usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
      pair: '0x1d8698365321D6DcE1F7141c380C866b012eE9dA',
      callbackProxy: '0x775c9B990ADe401060B78D0e98684eEf8d2466C1',
      supportedTemplates: ALL_TEMPLATES,
    },
  ],
  [
    BASE_SEPOLIA_CHAIN_ID,
    {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      name: 'Base Sepolia',
      network: 'testnet',
      nativeSymbol: 'ETH',
      role: 'funds',
      rpcUrl: 'https://sepolia.base.org',
      explorerUrl: 'https://sepolia.basescan.org',
      isOrigin: true,
      isDestination: true,
      router: '0x1689E7B1F10000AE47eBfE339a4f69dECd19F602',
      weth: '0x4200000000000000000000000000000000000006',
      usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      pair: '0x0B9Ab53880be6fF805ebF8FBce515E5715ccE1bE',
      callbackProxy: '0x476F44b11F5C942c58f4c8E3d0300E5710743585',
      supportedTemplates: ALL_TEMPLATES,
    },
  ],
  [
    UNICHAIN_MAINNET_CHAIN_ID,
    {
      chainId: UNICHAIN_MAINNET_CHAIN_ID,
      name: 'Unichain',
      network: 'mainnet',
      nativeSymbol: 'ETH',
      role: 'funds',
      rpcUrl: 'https://mainnet.unichain.org',
      explorerUrl: 'https://uniscan.xyz',
      isOrigin: true,
      isDestination: true,
      router: '0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C',
      weth: '0x4200000000000000000000000000000000000006',
      usdc: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
      pair: '0x8927058918e3CFf6F55EfE45A58db1be1F069E49',
      poolFee: 3000,
      callbackProxy: '0x754120EC7a6eF81E4c5c835AA603C63Da64693E6',
      ethUsdFeed: '0x41CFbbA7Be6E03fC43A19689b31852Af205da864',
      usdcUsdFeed: '0xbd1cD1518eFB92a92100da62D4C488c810dFd75b',
      sequencerFeed: '0x495639D9914e7D270c5dCC641BfB1d807423F813',
      supportedTemplates: ALL_TEMPLATES,
    },
  ],
  [
    BASE_MAINNET_CHAIN_ID,
    {
      chainId: BASE_MAINNET_CHAIN_ID,
      name: 'Base',
      network: 'mainnet',
      nativeSymbol: 'ETH',
      role: 'funds',
      rpcUrl: 'https://mainnet.base.org',
      explorerUrl: 'https://basescan.org',
      isOrigin: true,
      isDestination: true,
      router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
      weth: '0x4200000000000000000000000000000000000006',
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      pair: '0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C',
      callbackProxy: '0xCc780DdE33f56f55dE778D42c930959374a4a068',
      ethUsdFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
      usdcUsdFeed: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
      sequencerFeed: '0xBCF85224fc0756B9Fa45aA7892530B47e10b6433',
      supportedTemplates: ALL_TEMPLATES,
    },
  ],
]);

export const SUPPORTED_CHAIN_IDS = [
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export type ChainConfigFor<T extends SupportedChainId> = T extends AutomationChainId
  ? AutomationChainConfig
  : FundsChainConfig;

/** Error thrown for a chain this release does not configure. */
export class UnsupportedChainError extends Error {
  constructor(readonly chainId: number) {
    super(`Unsupported chain ${chainId}: only ${SUPPORTED_CHAIN_IDS.join(', ')} are configured`);
    this.name = 'UnsupportedChainError';
  }
}

/** Returns true when `chain` is a funds/settlement chain configuration. */
export function isFundsChainConfig(chain: ChainConfig): chain is FundsChainConfig {
  return chain.role === 'funds';
}

/** Returns the configuration for `chainId`, or throws `UnsupportedChainError`. */
export function getChain(chainId: AutomationChainId): AutomationChainConfig;
export function getChain(chainId: FundsChainId): FundsChainConfig;
export function getChain<T extends SupportedChainId>(chainId: T): ChainConfigFor<T>;
export function getChain(chainId: number): ChainConfig;
export function getChain(chainId: number): ChainConfig {
  const chain = CHAIN_CONFIGS.get(chainId);
  if (!chain) throw new UnsupportedChainError(chainId);
  return chain;
}

/** Returns the funds-chain configuration for `chainId`, or throws `UnsupportedChainError`. */
export function getFundsChain(chainId: number): FundsChainConfig {
  const chain = getChain(chainId);
  if (!isFundsChainConfig(chain)) throw new UnsupportedChainError(chainId);
  return chain;
}

/** Returns the templates the given chain can express, filtered by its config. */
export function supportedTemplatesFor(chainId: number): readonly number[] {
  return getChain(chainId).supportedTemplates;
}

export function automationChainFor(mode: NetworkMode): AutomationChainId {
  return mode === 'mainnet' ? REACTIVE_MAINNET_CHAIN_ID : LASNA_CHAIN_ID;
}

export function fundsChainsFor(mode: NetworkMode): readonly FundsChainId[] {
  return mode === 'mainnet' ? MAINNET_FUNDS_CHAIN_IDS : TESTNET_FUNDS_CHAIN_IDS;
}

export function defaultFundsChainFor(mode: NetworkMode): FundsChainId {
  return mode === 'mainnet' ? UNICHAIN_MAINNET_CHAIN_ID : UNICHAIN_SEPOLIA_CHAIN_ID;
}

export function networkModeForChain(chainId: number): NetworkMode {
  return getChain(chainId).network;
}

export function isSameNetworkMode(a: number, b: number): boolean {
  const chainA = CHAIN_CONFIGS.get(a);
  const chainB = CHAIN_CONFIGS.get(b);
  return !!chainA && !!chainB && chainA.network === chainB.network;
}

export function isFundsChainFor(automationChainId: number, fundsChainId: number): boolean {
  if (automationChainId === LASNA_CHAIN_ID) {
    return fundsChainId === UNICHAIN_SEPOLIA_CHAIN_ID || fundsChainId === BASE_SEPOLIA_CHAIN_ID;
  }
  if (automationChainId === REACTIVE_MAINNET_CHAIN_ID) {
    return fundsChainId === UNICHAIN_MAINNET_CHAIN_ID || fundsChainId === BASE_MAINNET_CHAIN_ID;
  }
  return false;
}

export function workflowDeploymentKey(
  automationChain: AutomationChainId,
  factory: Address,
): string {
  return `${automationChain}:${factory.toLowerCase()}`;
}
