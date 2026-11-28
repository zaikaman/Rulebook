import {
  workflowArchiveStateSchema,
  workflowListPageSchema,
  type workflowArchiveRequestSchema,
  type Address,
  type FundsChainId,
  type NetworkMode,
} from '@rulebook/shared';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import type { Hex } from 'viem';
import { z } from 'zod';

import { v2ApiBase } from './listingV2';
import { readWorkflowsV2 } from './chainV2';

const apiMessage = z.object({ message: z.string() });
class ArchiveConfirming extends Error {}

export function useWorkflowListParams(owner?: Address) {
  const [params, setParams] = useSearchParams();
  const after = params.get('after');
  const previous = useRef({ owner, after });
  useEffect(() => {
    const last = previous.current;
    previous.current = { owner, after };
    if (last.owner && last.owner !== owner && after && last.after === after) {
      const next = new URLSearchParams(params);
      next.delete('after');
      setParams(next, { replace: true });
    }
  }, [owner, after, params, setParams]);
  function setPage(cursor: string | null) {
    const next = new URLSearchParams(params);
    if (cursor) next.set('after', cursor);
    else next.delete('after');
    setParams(next);
  }
  return { params, setParams, after, setPage };
}

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${v2ApiBase}${path}`, { cache: 'no-store', ...init });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiMessage.safeParse(body);
    if (response.status === 425) throw new ArchiveConfirming();
    throw new Error(
      parsed.success ? parsed.data.message : 'Could not load the workflow. Try again.',
    );
  }
  return body;
}

export async function readWorkflowPage(
  owner: Address,
  network: NetworkMode,
  scope: 'current' | 'archived',
  after: string | null,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ owner, network, scope });
  if (after) params.set('after', after);
  const page = workflowListPageSchema.parse(
    await requestJson(`/v3/workflows?${params}`, { signal }),
  );
  return { ...page, ...(await readWorkflowsV2(owner, network, page.items)) };
}

export function archiveStateQueryKey(
  owner: Address | undefined,
  network: NetworkMode,
  workflow: Hex | undefined,
  chain: FundsChainId | undefined,
) {
  return ['workflow-v2', 'archive-state', network, owner, workflow, chain] as const;
}

export async function readArchiveState(
  owner: Address,
  network: NetworkMode,
  workflow: Hex,
  chain: FundsChainId,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ owner, network, workflow, chain: String(chain) });
  return workflowArchiveStateSchema.parse(
    await requestJson(`/v3/workflows/archive?${params}`, { signal }),
  );
}

export async function writeArchiveState(
  body: z.infer<typeof workflowArchiveRequestSchema> & { signature: Hex },
  onConfirming: () => void,
) {
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } as const;
  while (Date.now() + 1_000 < body.expires * 1000) {
    try {
      return workflowArchiveStateSchema.parse(await requestJson('/v3/workflows/archive', request));
    } catch (error) {
      if (!(error instanceof ArchiveConfirming)) throw error;
      onConfirming();
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
  }
  throw new Error('Confirmation is taking longer than expected. Finish archiving to try again.');
}
