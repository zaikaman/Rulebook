import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  defaultFundsChainFor,
  getChain,
  LASNA_CHAIN_ID,
  MAINNET_FUNDS_CHAIN_IDS,
  REACTIVE_MAINNET_CHAIN_ID,
  TESTNET_FUNDS_CHAIN_IDS,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowV2DeploymentSchema,
  workflowV2MainnetDeploymentSchema,
  type Address,
  type AutomationChainId,
  type FundsChainId,
  type NetworkMode,
  type WorkflowV2Deployment,
  type WorkflowV2MainnetDeployment,
} from '@rulebook/shared';

export const LASNA_CONFIG = getChain(LASNA_CHAIN_ID);
export const UNICHAIN_CONFIG = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
export const BASE_CONFIG = getChain(BASE_SEPOLIA_CHAIN_ID);

export interface ResolvedWorkflowV2Deployment {
  readonly mode: NetworkMode;
  readonly automationChainId: AutomationChainId;
  readonly automationFactory: Address;
  readonly unichain: {
    readonly chainId: FundsChainId;
    readonly factory: Address;
    readonly startBlock: number;
  };
  readonly base?: {
    readonly chainId: FundsChainId;
    readonly factory: Address;
    readonly startBlock: number;
  };
}

export function parseWorkflowV2TestnetDeployment(
  raw: string | undefined = import.meta.env.VITE_WORKFLOW_V2_DEPLOYMENT,
): WorkflowV2Deployment | undefined {
  try {
    return workflowV2DeploymentSchema.parse(JSON.parse(raw ?? 'null'));
  } catch {
    return undefined;
  }
}

export function parseWorkflowV2MainnetDeployment(
  raw: string | undefined = import.meta.env.VITE_WORKFLOW_V2_MAINNET_DEPLOYMENT,
): WorkflowV2MainnetDeployment | undefined {
  try {
    return workflowV2MainnetDeploymentSchema.parse(JSON.parse(raw ?? 'null'));
  } catch {
    return undefined;
  }
}

export function resolveWorkflowV2Deployment(
  mode: NetworkMode,
  rawTestnet?: string,
  rawMainnet?: string,
): ResolvedWorkflowV2Deployment | undefined {
  if (mode === 'mainnet') {
    const parsed = parseWorkflowV2MainnetDeployment(rawMainnet);
    if (!parsed) return undefined;
    return {
      mode: 'mainnet',
      automationChainId: REACTIVE_MAINNET_CHAIN_ID,
      automationFactory: parsed.reactive.factory,
      unichain: {
        chainId: UNICHAIN_MAINNET_CHAIN_ID,
        factory: parsed.unichain.factory,
        startBlock: parsed.unichain.startBlock,
      },
      ...(parsed.base
        ? {
            base: {
              chainId: BASE_MAINNET_CHAIN_ID,
              factory: parsed.base.factory,
              startBlock: parsed.base.startBlock,
            },
          }
        : {}),
    };
  }
  const parsed = parseWorkflowV2TestnetDeployment(rawTestnet);
  if (!parsed) return undefined;
  return {
    mode: 'testnet',
    automationChainId: LASNA_CHAIN_ID,
    automationFactory: parsed.lasna.factory,
    unichain: {
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      factory: parsed.unichain.factory,
      startBlock: parsed.unichain.startBlock,
    },
    ...(parsed.base
      ? {
          base: {
            chainId: BASE_SEPOLIA_CHAIN_ID,
            factory: parsed.base.factory,
            startBlock: parsed.base.startBlock,
          },
        }
      : {}),
  };
}

export function configuredFundsChainsFor(
  mode: NetworkMode,
  resolved?: ResolvedWorkflowV2Deployment,
): readonly FundsChainId[] {
  const candidates = mode === 'mainnet' ? MAINNET_FUNDS_CHAIN_IDS : TESTNET_FUNDS_CHAIN_IDS;
  const primary = defaultFundsChainFor(mode);
  return candidates.filter((chain) => chain === primary || Boolean(resolved?.base));
}
