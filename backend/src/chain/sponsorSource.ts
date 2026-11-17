import {
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { parseAbi } from 'viem';

import { clientFor, type ChainClients } from '../chain/clients.js';

/** Raw execution-credit facts for one chain. uint256 values stay decimal strings. */
export interface CreditReading {
  readonly chain_id: number;
  readonly reserves: string;
  readonly debt: string;
}

/** Reads the two on-chain figures `/v1/sponsor/:agent` reports. Holds no key. */
export interface SponsorSource {
  read(input: {
    readonly agent: Address;
    readonly vault: Address | null;
  }): Promise<CreditReading[]>;
}

const CREDIT_ABI = parseAbi([
  'function reserves(address account) view returns (uint256)',
  'function debt(address account) view returns (uint256)',
]);

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/**
 * The watching-side credit lives on the Lasna system contract; the funds-side callback
 * proxy carries the vault's debt. A failed read is reported as zero credit, which is the
 * honest direction to err: the UI warns rather than claiming the account is healthy.
 */
export class PublicSponsorSource implements SponsorSource {
  constructor(private readonly clients: ChainClients) {}

  async read(input: {
    readonly agent: Address;
    readonly vault: Address | null;
  }): Promise<CreditReading[]> {
    const lasna = getChain(LASNA_CHAIN_ID);
    const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
    const [watching, funds] = await Promise.all([
      this._read(LASNA_CHAIN_ID, lasna.systemContract, input.agent),
      this._read(UNICHAIN_SEPOLIA_CHAIN_ID, unichain.callbackProxy, input.vault ?? ZERO),
    ]);
    return [watching, funds];
  }

  private async _read(chainId: number, target: Address, account: Address): Promise<CreditReading> {
    if (account === ZERO) return { chain_id: chainId, reserves: '0', debt: '0' };
    const client = clientFor(this.clients, chainId);
    const [reserves, debt] = await Promise.all([
      client
        .readContract({
          address: target,
          abi: CREDIT_ABI,
          functionName: 'reserves',
          args: [account],
        })
        .catch(() => 0n),
      client
        .readContract({
          address: target,
          abi: CREDIT_ABI,
          functionName: 'debt',
          args: [account],
        })
        .catch(() => 0n),
    ]);
    return { chain_id: chainId, reserves: reserves.toString(), debt: debt.toString() };
  }
}
