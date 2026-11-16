import { agentAbi, vaultAbi } from '@rulebook/shared';
import type { Address } from 'viem';

import { clientFor, type ChainClients } from '../chain/clients.js';

/**
 * The two on-chain facts onboarding needs that the index can lag behind: whether the Agent
 * recorded the vault, and who owns a vault. Reads are best-effort: an RPC failure returns
 * null rather than letting the API claim a complete setup.
 */
export interface AccountChain {
  agentLink(agent: Address, chainId: number): Promise<Address | null>;
  vaultOwner(vault: Address): Promise<Address | null>;
}

/** Public-client implementation; holds no key and cannot write. */
export class PublicAccountChain implements AccountChain {
  constructor(private readonly clients: ChainClients) {}

  async agentLink(agent: Address, chainId: number): Promise<Address | null> {
    try {
      const vault = await clientFor(this.clients, 5_318_007).readContract({
        address: agent,
        abi: agentAbi,
        functionName: 'getVault',
        args: [BigInt(chainId)],
      });
      return vault === '0x0000000000000000000000000000000000000000' ? null : vault;
    } catch {
      return null;
    }
  }

  async vaultOwner(vault: Address): Promise<Address | null> {
    try {
      return await clientFor(this.clients, 1301).readContract({
        address: vault,
        abi: vaultAbi,
        functionName: 'owner',
      });
    } catch {
      return null;
    }
  }
}
