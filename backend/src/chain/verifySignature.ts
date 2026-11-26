import type { AutomationChainId } from '@rulebook/shared';
import { verifyMessage, type Address, type Hex, type PublicClient } from 'viem';

import { clientFor, type ChainClients } from './clients.js';

export interface WalletSignatureVerification {
  readonly address: Address;
  readonly message: string;
  readonly signature: Hex;
}

/**
 * Verifies an EOA signature locally first, then falls back to ERC-1271 `verifyMessage` on the
 * single automation chain belonging to the challenge's environment. Rejects cleanly (`false`) if
 * the client is unconfigured or evaluates the signature as invalid, and throws if the RPC check
 * fails.
 */
export async function verifyWalletSignature(
  clients: ChainClients,
  verification: WalletSignatureVerification,
  automationChain: AutomationChainId,
): Promise<boolean> {
  if (await verifyMessage(verification).catch(() => false)) {
    return true;
  }
  let target: PublicClient;
  try {
    target = clientFor(clients, automationChain);
  } catch {
    return false;
  }
  try {
    return await target.verifyMessage(verification);
  } catch {
    throw new Error('Could not verify the wallet signature.');
  }
}
