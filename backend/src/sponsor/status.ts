import {
  feeCreditWarningThreshold,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type ruleBudgetSchema,
  type sponsorStatusSchema,
} from '@rulebook/shared';
import { isAddress } from 'viem';
import type { z } from 'zod';

import type { CreditReading } from '../chain/sponsorSource.js';
import type { ServerDeps } from '../deps.js';

interface AccountCredit {
  readonly status: z.input<typeof sponsorStatusSchema>;
  readonly budget: z.input<typeof ruleBudgetSchema>;
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
    const destination = vaults.find(
      (vault) =>
        vault.chain_id === UNICHAIN_SEPOLIA_CHAIN_ID && vault.agent.toLowerCase() === agent,
    );
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
  const states = readings.map((reading) =>
    chainState(reading, feeCreditWarningThreshold(reading.chain_id)),
  );
  const state = worstState(states);
  const destination =
    readings.find((reading) => reading.chain_id === UNICHAIN_SEPOLIA_CHAIN_ID) ??
    readings.find((reading) => reading.chain_id === LASNA_CHAIN_ID);

  return {
    status: {
      agent,
      chains: readings.map((reading, index) => ({
        ...reading,
        state: states[index] ?? 'exhausted',
      })),
    },
    budget: {
      state,
      remaining: destination?.reserves ?? '0',
      threshold: feeCreditWarningThreshold(
        destination?.chain_id ?? UNICHAIN_SEPOLIA_CHAIN_ID,
      ).toString(),
      low: state === 'low',
      exhausted: state === 'exhausted' || state === 'debt',
    },
  };
}
