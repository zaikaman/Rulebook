import type { AutomationChainId } from '@rulebook/shared';
import { verifyMessage, type Address, type Hex, type PublicClient } from 'viem';

import { clientFor, type ChainClients } from './clients.js';

export interface WalletSignatureVerification {
  readonly address: Address;
  readonly message: string;
  readonly signature: Hex;
}

/**
 * Verifies an EOA signature locally first, then falls back to ERC-1271 `verifyMessage` across the
 * configured automation chains. Rejects cleanly (`false`) if at least one chain evaluates the
 * signature as invalid and none confirm it, and only throws when every attempted RPC check fails.
 */
export async function verifyWalletSignature(
  clients: ChainClients,
  verification: WalletSignatureVerification,
  automationChains: readonly AutomationChainId[],
): Promise<boolean> {
  if (await verifyMessage(verification).catch(() => false)) {
    return true;
  }
  const targets: PublicClient[] = [];
  for (const chainId of automationChains) {
    try {
      targets.push(clientFor(clients, chainId));
    } catch {
      // Unconfigured client for this chainId.
    }
  }
  if (targets.length === 0) return false;

  const outcomes = await Promise.allSettled(
    targets.map((client) => client.verifyMessage(verification)),
  );
  if (outcomes.some((outcome) => outcome.status === 'fulfilled' && outcome.value)) {
    return true;
  }
  if (outcomes.some((outcome) => outcome.status === 'fulfilled')) {
    return false;
  }
  throw new Error('Could not verify the wallet signature.');
}
