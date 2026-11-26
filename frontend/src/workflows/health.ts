import {
  decodeWorkflowV2,
  deriveWorkflowHealth,
  isFundsChain,
  networkModeForChain,
  workflowHealthKey,
  workflowHealthResponseSchema,
  type FundsChainId,
  type NetworkMode,
  type WorkflowHealth,
  type WorkflowHealthEntry,
  type WorkflowHealthRunSchema,
  type WorkflowHealthSuccess,
} from '@rulebook/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { zeroAddress, type Address } from 'viem';

import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { appRoutes } from '@/lib/routes';
import { configuredFundsChains, readFundsV2, readWorkflowV2 } from './chainV2';
import { workflowFundingNeeds } from './fundingV2';
import { v2ApiBase } from './listingV2';
import { useWorkflowCredits } from './WorkflowCredit';

export type WorkflowHealthItem = Pick<
  Awaited<ReturnType<typeof readWorkflowV2>>,
  | 'id'
  | 'chain'
  | 'active'
  | 'staged'
  | 'partiallyPaused'
  | 'closed'
  | 'program'
  | 'budget'
  | 'auth'
>;

export interface WorkflowHealthRow {
  readonly chain: FundsChainId;
  readonly health: WorkflowHealth;
  readonly lastRun: WorkflowHealthRunSchema | null;
  readonly lastSuccess: WorkflowHealthSuccess | null;
}

async function readOwnerHealth(owner: Address, mode: NetworkMode, signal: AbortSignal) {
  const response = await fetch(`${v2ApiBase}/v3/health?owner=${owner}&network=${mode}`, {
    signal,
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Workflow health could not be loaded.');
  return workflowHealthResponseSchema.parse(await response.json());
}

/**
 * Combines on-chain workflow state with indexed run evidence. The indexed endpoint supplies only
 * last-run facts; credit and budget always come from their on-chain sources.
 */
export function useWorkflowHealth(
  owner: Address | undefined,
  workflows: readonly WorkflowHealthItem[] | undefined,
) {
  const { mode, defaultFundsChainId, isDeploymentConfigured } = useNetworkMode();
  const credits = useWorkflowCredits(owner);
  const query = useQuery({
    queryKey: ['workflow-v2', 'health', mode, owner?.toLowerCase()],
    enabled: Boolean(owner && isDeploymentConfigured),
    queryFn: ({ signal }) => readOwnerHealth(owner!, mode, signal),
    refetchInterval: 12_000,
    retry: 1,
  });
  const chains = configuredFundsChains(mode);
  const fundQueries = useQueries({
    queries: chains.map((chain) => ({
      queryKey: ['workflow-v2', 'vault-funds', mode, owner?.toLowerCase(), chain],
      enabled: Boolean(owner && isDeploymentConfigured),
      queryFn: () => readFundsV2(owner!, chain),
      refetchInterval: 12_000,
      retry: 1,
    })),
  });
  const funds = fundQueries[0]!;
  const fundsByChain = new Map<FundsChainId, Awaited<ReturnType<typeof readFundsV2>> | undefined>(
    chains.map((chain, index) => [chain, fundQueries[index]?.data]),
  );
  const indexed = new Map<string, WorkflowHealthEntry>(
    (query.data?.workflows ?? []).map((entry) => [
      workflowHealthKey(entry.chain, entry.workflowId),
      entry,
    ]),
  );
  const rows = new Map<string, WorkflowHealthRow>();

  for (const item of workflows ?? []) {
    let program: ReturnType<typeof decodeWorkflowV2>;
    try {
      program = decodeWorkflowV2(item.program);
    } catch {
      continue;
    }
    const settlementChain: FundsChainId = isFundsChain(item.chain)
      ? item.chain
      : isFundsChain(program.chain)
        ? program.chain
        : defaultFundsChainId;
    const key = workflowHealthKey(settlementChain, item.id);
    const entry = indexed.get(key);
    const needs = workflowFundingNeeds(program);
    const balances = fundsByChain.get(settlementChain);
    const executionCredit = credits.byChain?.[settlementChain] ?? null;
    rows.set(key, {
      chain: settlementChain,
      health: deriveWorkflowHealth({
        active: item.active,
        readyToActivate: !item.active && item.staged && Boolean(item.auth[3]),
        partiallyPaused: item.partiallyPaused,
        closed: item.closed,
        program,
        executionCredit,
        watchingCredit: credits.readings.watching,
        budget: item.budget,
        funding:
          balances && balances.vault !== zeroAddress
            ? {
                usdc: needs.vaultUsdc > balances.stable ? needs.vaultUsdc - balances.stable : 0n,
                weth: needs.vaultWeth > balances.wrapped ? needs.vaultWeth - balances.wrapped : 0n,
              }
            : null,
        lastRun: entry?.lastRun ?? null,
      }),
      lastRun: entry?.lastRun ?? null,
      lastSuccess: entry?.lastSuccess ?? null,
    });
  }

  return {
    rows,
    query,
    funds,
    pending: credits.checking || query.isPending,
    runsUnavailable: query.isError,
    creditsUnavailable: credits.unavailable,
  };
}

export function workflowHealthHref(
  health: WorkflowHealth,
  workflowId: string,
  lastRunId?: string | null,
  chain?: FundsChainId,
  mode?: NetworkMode,
) {
  const resolvedMode = mode ?? (chain ? networkModeForChain(chain) : 'testnet');
  const chainSuffix = chain ? `&chain=${chain}` : '';
  const chainQuery = chain ? `?chain=${chain}` : '';
  let href: string | undefined;
  switch (health.fix) {
    case 'execution-credit':
      href = `${appRoutes.account}?credit=execution${chainSuffix}`;
      break;
    case 'watching-credit':
      href = `${appRoutes.account}?credit=watching`;
      break;
    case 'weekly-budget':
      href = `${appRoutes.workflows}/${workflowId}?budget=1${chainSuffix}#weekly-budget`;
      break;
    case 'account':
    case 'allowance':
      href = `${appRoutes.account}${chainQuery}`;
      break;
    case 'edit':
      href = `${appRoutes.workflows}/${workflowId}/edit${chainQuery}`;
      break;
    case 'pause':
      href = `${appRoutes.workflows}/${workflowId}${chainQuery}`;
      break;
    case 'run':
      href = lastRunId
        ? `${appRoutes.runs}/${lastRunId}`
        : `${appRoutes.activity}?workflow=${workflowId}`;
      break;
    case 'activity':
      href = `${appRoutes.activity}?workflow=${workflowId}`;
      break;
    case 'none':
      href = undefined;
      break;
  }
  return href ? withNetworkQuery(href, resolvedMode) : undefined;
}

export const workflowRunStatusLabels: Record<WorkflowHealthRunSchema['status'], string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  skipped: 'Skipped',
  expired: 'Expired',
  failed: 'Failed',
  'in grace period': 'In grace period',
};

export function shortRun(id: string) {
  return `${id.slice(0, 10)}…`;
}
