import {
  addressSchema,
  fundsChainIdSchema,
  LASNA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowHexSchema,
  workflowIdSchema,
} from '@rulebook/shared';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { decodeFunctionResult, encodeFunctionData, keccak256, maxUint256 } from 'viem';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { workflowClient, workflowV2Deployment } from './chainV2';

export const v2ApiBase = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787').replace(
  /\/$/,
  '',
);
export const v2ListingId = z
  .string()
  .regex(/^[1-9]\d{0,77}$/)
  .pipe(z.string().refine((id) => BigInt(id) <= maxUint256));
const listing = z.object({
  id: v2ListingId,
  title: z.string(),
  description: z.string(),
  owner: addressSchema,
  agent: addressSchema,
  workflow_id: workflowIdSchema,
  program_hash: workflowIdSchema,
  chain: fundsChainIdSchema,
  program: workflowHexSchema,
});
export const v2MarketPage = z.object({
  listings: z.array(listing),
  nextCursor: z.string().nullable(),
});

const listingReadMessages = {
  syncing: 'The Marketplace is still syncing this listing.',
  unavailable: 'This listing is no longer public or does not exist.',
  unverified: 'The listing details could not be verified on Lasna.',
  unconfigured: 'The testnet Marketplace is unavailable.',
};

export class ListingReadError extends Error {
  constructor(readonly kind: keyof typeof listingReadMessages) {
    super(listingReadMessages[kind]);
  }
}

async function getV2Listing(id: string, signal: AbortSignal) {
  const factory = workflowV2Deployment?.lasna.factory;
  if (!factory) throw new ListingReadError('unconfigured');
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const response = await fetch(`${v2ApiBase}/v3/marketplace/${id}`, {
    cache: 'no-store',
    signal: requestSignal,
  });
  if (!response.ok && response.status !== 404)
    throw new ApiError(
      'http_error',
      'The Marketplace could not load this listing.',
      null,
      response.status,
    );

  const call = { abi: workflowAgentFactoryV2Abi, functionName: 'listings' } as const;
  const { data } = await workflowClient(LASNA_CHAIN_ID).call({
    to: factory,
    data: encodeFunctionData({ ...call, args: [BigInt(id)] }),
    requestOptions: { signal: requestSignal, retryCount: 0 },
  });
  if (!data) throw new ListingReadError('unverified');
  const [owner, agent, workflow, hash, visible] = decodeFunctionResult({ ...call, data });
  if (!visible) throw new ListingReadError('unavailable');
  if (!response.ok) throw new ListingReadError('syncing');
  const body: unknown = await response.json().catch((error: unknown) => {
    if (error instanceof SyntaxError) throw new ListingReadError('unverified');
    throw error;
  });
  const parsed = listing.safeParse(body);
  if (!parsed.success) throw new ListingReadError('unverified');
  const item = parsed.data;
  if (
    item.id !== id ||
    owner.toLowerCase() !== item.owner.toLowerCase() ||
    agent.toLowerCase() !== item.agent.toLowerCase() ||
    workflow !== item.workflow_id ||
    hash !== item.program_hash ||
    keccak256(item.program) !== hash
  )
    throw new ListingReadError('unverified');
  return item;
}

export function v2ListingQuery(id: string | undefined) {
  return queryOptions({
    queryKey: ['workflow-v2', 'listing', id],
    queryFn: id ? ({ signal }) => getV2Listing(id, signal) : skipToken,
    staleTime: 0,
    retry: (failures, error) => {
      if (error instanceof ListingReadError && error.kind !== 'syncing') return false;
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) return false;
      // A transient request failure during indexing still gets the remaining retry budget.
      return failures < 24;
    },
    // The indexer checks for newly confirmed blocks every five seconds.
    retryDelay: 5_000,
  });
}
