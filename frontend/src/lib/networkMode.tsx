import {
  automationChainFor,
  defaultFundsChainFor,
  fundsChainsFor,
  getChain,
  type AutomationChainId,
  type FundsChainId,
  type NetworkMode,
} from '@rulebook/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  configuredFundsChainsFor,
  resolveWorkflowV2Deployment,
  type ResolvedWorkflowV2Deployment,
} from './contracts.js';

export const NETWORK_MODE_STORAGE_KEY = 'rulebook.networkMode';

export function getStoredNetworkMode(): NetworkMode {
  try {
    const stored =
      typeof window !== 'undefined' ? window.localStorage.getItem(NETWORK_MODE_STORAGE_KEY) : null;
    return stored === 'mainnet' ? 'mainnet' : 'testnet';
  } catch {
    return 'testnet';
  }
}

export interface NetworkModeState {
  readonly mode: NetworkMode;
  readonly isMainnet: boolean;
  readonly automationChainId: AutomationChainId;
  readonly automationName: string;
  readonly nativeSymbol: 'lREACT' | 'REACT';
  readonly fundsChainIds: readonly FundsChainId[];
  readonly defaultFundsChainId: FundsChainId;
  readonly configuredFundsChains: readonly FundsChainId[];
  readonly deployment: ResolvedWorkflowV2Deployment | undefined;
  readonly isDeploymentConfigured: boolean;
}

export interface NetworkModeContextValue extends NetworkModeState {
  readonly setMode: (next: NetworkMode) => void;
}

export function buildNetworkModeState(
  mode: NetworkMode,
  rawTestnet?: string,
  rawMainnet?: string,
): NetworkModeState {
  const automationChainId = automationChainFor(mode);
  const automation = getChain(automationChainId);
  const deployment = resolveWorkflowV2Deployment(mode, rawTestnet, rawMainnet);
  return {
    mode,
    isMainnet: mode === 'mainnet',
    automationChainId,
    automationName: automation.name,
    nativeSymbol: automation.nativeSymbol === 'REACT' ? 'REACT' : 'lREACT',
    fundsChainIds: fundsChainsFor(mode),
    defaultFundsChainId: defaultFundsChainFor(mode),
    configuredFundsChains: configuredFundsChainsFor(mode, deployment),
    deployment,
    isDeploymentConfigured: Boolean(deployment),
  };
}

const defaultContextValue: NetworkModeContextValue = {
  ...buildNetworkModeState('testnet'),
  setMode: () => undefined,
};

const NetworkModeContext = createContext<NetworkModeContextValue>(defaultContextValue);

export function NetworkModeProvider({ children }: { readonly children: ReactNode }) {
  const [mode, setModeState] = useState<NetworkMode>(() => getStoredNetworkMode());
  const queryClient = useQueryClient();

  const setMode = useCallback(
    (next: NetworkMode) => {
      try {
        window.localStorage.setItem(NETWORK_MODE_STORAGE_KEY, next);
      } catch {
        // Storage can be blocked in strict privacy contexts.
      }
      setModeState(next);
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const value = useMemo<NetworkModeContextValue>(
    () => ({
      ...buildNetworkModeState(mode),
      setMode,
    }),
    [mode, setMode],
  );

  return <NetworkModeContext.Provider value={value}>{children}</NetworkModeContext.Provider>;
}

export function useNetworkMode(): NetworkModeContextValue {
  return useContext(NetworkModeContext);
}
