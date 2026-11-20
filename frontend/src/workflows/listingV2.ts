import {
  addressSchema,
  decodeWorkflowV2,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowIdSchema,
} from '@rulebook/shared';
import { keccak256, type Hex } from 'viem';
import { z } from 'zod';
import { workflowClient, workflowV2Deployment } from './chainV2';
import { toDraft, type DraftPath } from './modelV2';

export const v2ApiBase = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787').replace(
  /\/$/,
  '',
);
export const v2ListingId = z.string().regex(/^[1-9]\d{0,77}$/);
const listing = z.object({
  id: v2ListingId,
  title: z.string(),
  description: z.string(),
  owner: addressSchema,
  agent: addressSchema,
  workflow_id: workflowIdSchema,
  program_hash: workflowIdSchema,
  chain: z.literal(UNICHAIN_SEPOLIA_CHAIN_ID),
  program: z
    .string()
    .regex(/^0x[\da-f]+$/i)
    .transform((value) => value as Hex),
});
export const v2MarketPage = z.object({
  listings: z.array(listing),
  nextCursor: z.string().nullable(),
});

export async function getV2Listing(id: string, signal?: AbortSignal) {
  const factory = workflowV2Deployment?.lasna.factory;
  if (!factory) throw new Error('The testnet Marketplace is unavailable.');
  const response = await fetch(`${v2ApiBase}/v3/marketplace/${v2ListingId.parse(id)}`, { signal });
  if (!response.ok) throw new Error('This listing could not be loaded.');
  const item = listing.parse(await response.json());
  const [owner, agent, workflow, hash, visible] = await workflowClient(LASNA_CHAIN_ID).readContract(
    {
      address: factory,
      abi: workflowAgentFactoryV2Abi,
      functionName: 'listings',
      args: [BigInt(id)],
    },
  );
  if (
    !visible ||
    owner.toLowerCase() !== item.owner.toLowerCase() ||
    agent.toLowerCase() !== item.agent.toLowerCase() ||
    workflow !== item.workflow_id ||
    hash !== item.program_hash ||
    keccak256(item.program) !== hash
  )
    throw new Error('This listing is unavailable on Lasna.');
  return item;
}

export function copyListingDraft(item: Awaited<ReturnType<typeof getV2Listing>>) {
  const draft = toDraft(decodeWorkflowV2(item.program), item.title);
  function clear(path: DraftPath): DraftPath {
    if ('steps' in path) return { steps: path.steps.map((step) => ({ ...step, recipient: '' })) };
    return { ...path, yes: clear(path.yes), no: clear(path.no) };
  }
  return { ...draft, expires: '', subject: '', usdcCap: '', wethCap: '', root: clear(draft.root) };
}
