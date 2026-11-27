import { type Address, type DemoFeaturedRun } from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router';
import { useAccount } from 'wagmi';

import { api } from './api.js';
import { resolveWorkflowV2Deployment } from './contracts.js';
import { useNetworkMode } from './networkMode.js';

export const DEMO_MODE_STORAGE_KEY = 'rulebook.demoMode';

function getInitialDemoRequested(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location.search).get('demo');
    if (param === '1') return true;
    if (param === '0') return false;
  } catch {
    // Ignore malformed query strings.
  }
  try {
    return window.sessionStorage.getItem(DEMO_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setStoredDemoMode(enabled: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    if (enabled) window.sessionStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    else window.sessionStorage.removeItem(DEMO_MODE_STORAGE_KEY);
  } catch {
    // Storage can be blocked in strict privacy contexts.
  }
}

export interface DemoModeContextValue {
  readonly isDemoMode: boolean;
  readonly demoAvailable: boolean;
  readonly demoOwner: Address | undefined;
  readonly connectedOwner: Address | undefined;
  readonly viewOwner: Address | undefined;
  readonly featuredRuns: readonly DemoFeaturedRun[];
  readonly enterDemoMode: () => void;
  readonly exitDemoMode: () => void;
}

const defaultDemoContextValue: DemoModeContextValue = {
  isDemoMode: false,
  demoAvailable: false,
  demoOwner: undefined,
  connectedOwner: undefined,
  viewOwner: undefined,
  featuredRuns: [],
  enterDemoMode: () => undefined,
  exitDemoMode: () => undefined,
};

const DemoModeContext = createContext<DemoModeContextValue>(defaultDemoContextValue);

export function DemoModeProvider({ children }: { readonly children: ReactNode }) {
  const { address: connectedAddress } = useAccount();
  const { mode, setMode, isDeploymentConfigured } = useNetworkMode();
  const [demoRequested, setDemoRequested] = useState<boolean>(() => getInitialDemoRequested());
  const testnetConfigured = Boolean(resolveWorkflowV2Deployment('testnet'));

  const demoQuery = useQuery({
    queryKey: ['workflow-v2', 'demo-account'],
    enabled: testnetConfigured,
    queryFn: ({ signal }) => api.demoAccount(signal, 'testnet'),
    staleTime: 60_000,
    retry: false,
  });

  const demoOwner = demoQuery.data?.available ? (demoQuery.data.owner ?? undefined) : undefined;
  const featuredRuns: readonly DemoFeaturedRun[] = useMemo(
    () => demoQuery.data?.featuredRuns ?? [],
    [demoQuery.data?.featuredRuns],
  );
  const demoAvailable = Boolean(demoOwner && testnetConfigured);
  const connectedOwner = connectedAddress?.toLowerCase() as Address | undefined;

  useEffect(() => {
    if (connectedOwner) {
      setDemoRequested(false);
      setStoredDemoMode(false);
    }
  }, [connectedOwner]);

  const enterDemoMode = useCallback(() => {
    if (connectedOwner) return;
    if (mode !== 'testnet') {
      setMode('testnet');
    }
    setDemoRequested(true);
    setStoredDemoMode(true);
  }, [connectedOwner, mode, setMode]);

  const exitDemoMode = useCallback(() => {
    setDemoRequested(false);
    setStoredDemoMode(false);
  }, []);

  const isDemoMode = Boolean(
    !connectedOwner && demoRequested && demoOwner && mode === 'testnet' && isDeploymentConfigured,
  );
  const viewOwner = connectedOwner ?? (isDemoMode ? demoOwner : undefined);

  const value = useMemo<DemoModeContextValue>(
    () => ({
      isDemoMode,
      demoAvailable,
      demoOwner,
      connectedOwner,
      viewOwner,
      featuredRuns,
      enterDemoMode,
      exitDemoMode,
    }),
    [
      isDemoMode,
      demoAvailable,
      demoOwner,
      connectedOwner,
      viewOwner,
      featuredRuns,
      enterDemoMode,
      exitDemoMode,
    ],
  );

  return <DemoModeContext.Provider value={value}>{children}</DemoModeContext.Provider>;
}

export function DemoModeQuerySync() {
  const { connectedOwner, enterDemoMode, exitDemoMode } = useDemoMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const demoParam = searchParams.get('demo');

  useEffect(() => {
    if (demoParam !== '1' && demoParam !== '0') return;
    if (demoParam === '1' && !connectedOwner) {
      enterDemoMode();
    } else if (demoParam === '0') {
      exitDemoMode();
    }
    setSearchParams(
      (current) => {
        if (!current.has('demo')) return current;
        const next = new URLSearchParams(current);
        next.delete('demo');
        return next;
      },
      { replace: true },
    );
  }, [connectedOwner, demoParam, enterDemoMode, exitDemoMode, setSearchParams]);

  return null;
}

export function useDemoMode(): DemoModeContextValue {
  return useContext(DemoModeContext);
}
