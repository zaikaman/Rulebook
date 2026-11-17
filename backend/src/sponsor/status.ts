import {
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type RuleBudget,
  type SponsorStatus,
} from '@rulebook/shared';
import { isAddress } from 'viem';

import type { CreditReading } from '../chain/sponsorSource.js';
import type { ServerDeps } from '../deps.js';

export interface AccountCredit {
  readonly status: SponsorStatus;
  readonly budget: RuleBudget;
}

type SponsorState = 'healthy' | 'low' | 'exhausted' | 'debt';

const SEVERITY: Record<SponsorState, number> = {
  healthy: 0,
  low: 1,
  exhausted: 2,
  debt: 3,
};

function chainState(reading: CreditReading, threshold: bigint): SponsorState {
  const reserves = BigInt(reading.reserves);
  const debt = BigInt(reading.debt);
  if (debt > 0n) return 'debt';
  if (reserves === 0n) return 'exhausted';
  if (reserves < threshold) return 'low';
  return 'healthy';
}

function worstState(states: readonly SponsorState[]): SponsorState {
  return states.reduce<SponsorState>(
    (worst, state) => (SEVERITY[state] > SEVERITY[worst] ? state : worst),
    'healthy',
  );
}

async function resolveVault(deps: ServerDeps, agent: Address): Promise<Address | null> {
  const row = await deps.repositories.agents.get(agent);
  if (row) {
    const vaults = await deps.repositories.vaults.listByOwner(row.owner);
    const destination = vaults.find((vault) => vault.chain_id === UNICHAIN_SEPOLIA_CHAIN_ID);
    if (destination) return destination.address as Address;
  }
  try {
    return await deps.accountChain.agentLink(agent, UNICHAIN_SEPOLIA_CHAIN_ID);
  } catch {
    return null;
  }
}

/**
 * Reads the execution-credit state for one account. Returns null when no sponsor source is
 * configured, so routes can omit the fields rather than invent a healthy-looking zero.
 */
export async function loadAccountCredit(
  deps: ServerDeps,
  agentParam: string,
): Promise<AccountCredit | null> {
  if (!isAddress(agentParam)) return null;
  if (!deps.sponsorSource) return null;

  const agent = agentParam.toLowerCase() as Address;
  const vault = await resolveVault(deps, agent);
  const readings = await deps.sponsorSource.read({ agent, vault });
  const threshold = BigInt(deps.config.SPONSOR_GAS_TOP_UP_WEI);
  const states = readings.map((reading) => chainState(reading, threshold));
  const state = worstState(states);
  const destination =
    readings.find((reading) => reading.chain_id === UNICHAIN_SEPOLIA_CHAIN_ID) ??
    readings.find((reading) => reading.chain_id === LASNA_CHAIN_ID);

  return {
    status: {
      agent,
      chains: readings.map((reading, index) => ({
        chain_id: reading.chain_id,
        reserves: BigInt(reading.reserves),
        debt: BigInt(reading.debt),
        state: states[index] ?? 'exhausted',
      })),
    },
    budget: {
      state,
      remaining: BigInt(destination?.reserves ?? '0'),
      threshold,
      low: state === 'low',
      exhausted: state === 'exhausted' || state === 'debt',
    },
  };
}
