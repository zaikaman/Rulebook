import {
  automationChainFor,
  fundsChainIdSchema,
  workflowAgentV2Abi,
  workflowVaultV2Abi,
  type Address,
  type FundsChainId,
  type NetworkMode,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { BaseError, isAddressEqual, zeroAddress } from 'viem';
import { useAccount } from 'wagmi';

import type { LinkedAccount } from '../components/AccountSetupGate.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { Spinner } from '../components/chrome/Spinner.js';
import { ErrorState } from '../components/ErrorState.js';
import { useNetworkMode, withNetworkQuery } from '../lib/networkMode.js';
import { appRoutes, setupHref, stripNetworkQuery } from '../lib/routes.js';
import { configuredFundsChains, readAgent, readVault, workflowClient } from './chainV2.js';

export function linkedAccountQueryKey(mode: NetworkMode, owner?: Address) {
  return ['workflow-v2', 'linked-account', mode, owner?.toLowerCase()] as const;
}

export async function findLinkedWorkflowChain(
  owner: Address,
  mode: NetworkMode = 'testnet',
): Promise<LinkedAccount | null> {
  const agent = await readAgent(owner, undefined, mode);
  if (agent === zeroAddress) return null;
  const autoChain = automationChainFor(mode);
  let lastError: unknown;
  let checkedAny = false;
  for (const chain of configuredFundsChains(mode)) {
    try {
      const vault = await readVault(owner, chain);
      checkedAny = true;
      if (vault === zeroAddress) continue;
      const [linkedVault, linkedAgent] = await Promise.all([
        workflowClient(autoChain).readContract({
          address: agent,
          abi: workflowAgentV2Abi,
          functionName: 'vaults',
          args: [chain],
        }),
        workflowClient(chain).readContract({
          address: vault,
          abi: workflowVaultV2Abi,
          functionName: 'agent',
        }),
      ]);
      if (isAddressEqual(linkedVault, vault) && isAddressEqual(linkedAgent, agent)) {
        return { agent, vault, chain };
      }
    } catch (cause) {
      lastError = cause;
    }
  }
  if (!checkedAny && lastError) throw lastError;
  return null;
}

export function useLinkedAccount() {
  const { mode, isDeploymentConfigured, deployment } = useNetworkMode();
  const { address, isReconnecting } = useAccount();
  const owner = isReconnecting ? undefined : (address?.toLowerCase() as Address | undefined);
  const enabled = Boolean(owner && isDeploymentConfigured && deployment);
  const query = useQuery({
    queryKey: linkedAccountQueryKey(mode, owner),
    enabled,
    queryFn: () => findLinkedWorkflowChain(owner!, mode),
    retry: false,
    staleTime: 15_000,
  });

  return {
    owner,
    isReconnecting,
    isDeploymentConfigured,
    linked: query.data ?? null,
    isPending: Boolean(enabled && query.isPending),
    isFetching: Boolean(enabled && query.isFetching),
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function RequireAccountSetup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: (linked: LinkedAccount | null) => ReactNode;
}) {
  const { mode } = useNetworkMode();
  const location = useLocation();
  const {
    owner,
    isReconnecting,
    isDeploymentConfigured,
    linked,
    isPending,
    isError,
    error,
    refetch,
  } = useLinkedAccount();

  if (!isDeploymentConfigured || (!owner && !isReconnecting)) {
    return children(null);
  }

  if (isReconnecting || isPending) {
    return (
      <section className="app-page">
        <PageHeading title={title} />
        <Spinner
          label={isReconnecting ? 'Reconnecting your wallet…' : 'Checking for an existing account…'}
        />
      </section>
    );
  }

  if (isError) {
    return (
      <section className="app-page">
        <PageHeading title={title} />
        <ErrorState
          message="Your account status could not be loaded."
          detail={error instanceof BaseError ? error.shortMessage : error?.message}
          onRetry={() => void refetch()}
        >
          <Link to={withNetworkQuery(appRoutes.accountFunds, mode)} className="app-link">
            Manage existing vault funds
          </Link>
        </ErrorState>
      </section>
    );
  }

  if (owner && linked === null) {
    const currentPath = stripNetworkQuery(`${location.pathname}${location.search}`);
    const params = new URLSearchParams(location.search);
    const parsedChain = fundsChainIdSchema.safeParse(Number(params.get('chain')));
    const chain: FundsChainId | undefined =
      parsedChain.success && configuredFundsChains(mode).includes(parsedChain.data)
        ? parsedChain.data
        : undefined;
    return <Navigate to={setupHref({ next: currentPath, chain, mode })} replace />;
  }

  return children(linked);
}
