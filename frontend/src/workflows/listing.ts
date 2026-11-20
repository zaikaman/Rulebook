import { workflowDirectoryAbi, type WorkflowListing } from '@rulebook/shared';
import { keccak256 } from 'viem';
import { lasnaPublicClient } from '@/lib/wagmi';
import { workflowDirectory } from './chain';

export async function verifyListing(listing: WorkflowListing) {
  if (!workflowDirectory) throw new Error('The workflow registry is not configured.');
  const [author, agent, id, hash, , visible] = await lasnaPublicClient.readContract({
    abi: workflowDirectoryAbi,
    address: workflowDirectory,
    functionName: 'listings',
    args: [BigInt(listing.id)],
  });
  if (
    !visible ||
    hash !== listing.programHash ||
    keccak256(listing.program) !== hash ||
    id !== listing.workflowId ||
    author.toLowerCase() !== listing.author.toLowerCase() ||
    agent.toLowerCase() !== listing.agent.toLowerCase()
  ) {
    throw new Error('This listing no longer matches the on-chain registry.');
  }
}
