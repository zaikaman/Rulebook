import {
  decodeWorkflowV2,
  deriveWorkflowHealth,
  workflowHealthResponseSchema,
  type WorkflowHealth,
  type WorkflowHealthEntry,
  type WorkflowHealthRunSchema,
  type WorkflowHealthSuccess,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';

import { appRoutes } from '@/lib/routes';
import { readWorkflowV2, workflowV2Deployment } from './chainV2';
import { v2ApiBase } from './listingV2';
import { useWorkflowCredits } from './WorkflowCredit';

export type WorkflowHealthItem = Pick<
  Awaited<ReturnType<typeof readWorkflowV2>>,
  'id' | 'active' | 'staged' | 'closed' | 'program' | 'budget' | 'auth'
>;

export interface WorkflowHealthRow {
  readonly health: WorkflowHealth;
  readonly lastRun: WorkflowHealthRunSchema | null;
  readonly lastSuccess: WorkflowHealthSuccess | null;
}

async function readOwnerHealth(owner: Address, signal: AbortSignal) {
  const response = await fetch(`${v2ApiBase}/v3/health?owner=${owner}`, {
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
  const credits = useWorkflowCredits(owner);
  const query = useQuery({
    queryKey: ['workflow-v2', 'health', owner?.toLowerCase()],
    enabled: Boolean(owner && workflowV2Deployment),
    queryFn: ({ signal }) => readOwnerHealth(owner!, signal),
    refetchInterval: 12_000,
    retry: 1,
  });
  const indexed = new Map<string, WorkflowHealthEntry>(
    (query.data?.workflows ?? []).map((entry) => [entry.workflowId, entry]),
  );
  const rows = new Map<string, WorkflowHealthRow>();

  for (const item of workflows ?? []) {
    let program: ReturnType<typeof decodeWorkflowV2>;
    try {
      program = decodeWorkflowV2(item.program);
    } catch {
      continue;
    }
    const entry = indexed.get(item.id);
    rows.set(item.id, {
      health: deriveWorkflowHealth({
        active: item.active,
        readyToActivate: !item.active && item.staged && Boolean(item.auth[3]),
        closed: item.closed,
        program,
        executionCredit: credits.readings.execution,
        watchingCredit: credits.readings.watching,
        budget: item.budget,
        lastRun: entry?.lastRun ?? null,
      }),
      lastRun: entry?.lastRun ?? null,
      lastSuccess: entry?.lastSuccess ?? null,
    });
  }

  return {
    rows,
    query,
    pending: credits.checking || query.isPending,
    runsUnavailable: query.isError,
    creditsUnavailable: credits.unavailable,
  };
}

export function workflowHealthHref(
  health: WorkflowHealth,
  workflowId: string,
  lastRunId?: string | null,
) {
  switch (health.fix) {
    case 'execution-credit':
      return `${appRoutes.account}?credit=execution`;
    case 'watching-credit':
      return `${appRoutes.account}?credit=watching`;
    case 'weekly-budget':
      return `${appRoutes.workflows}/${workflowId}?budget=1#weekly-budget`;
    case 'account':
    case 'allowance':
      return appRoutes.account;
    case 'edit':
      return `${appRoutes.workflows}/${workflowId}/edit`;
    case 'run':
      return lastRunId
        ? `${appRoutes.runs}/${lastRunId}`
        : `${appRoutes.activity}?workflow=${workflowId}`;
    case 'activity':
      return `${appRoutes.activity}?workflow=${workflowId}`;
    case 'none':
      return undefined;
  }
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
