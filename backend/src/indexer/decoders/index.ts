import {
  agentAbi,
  agentFactoryAbi,
  ruleRegistryAbi,
  vaultAbi,
  vaultFactoryAbi,
} from '@rulebook/shared';
import { decodeEventLog, parseAbiItem, toEventSelector, type Abi } from 'viem';
import { z } from 'zod';

import type { Repositories } from '../../db/repositories/index.js';

const LA = 5_318_007;
const UNI = 1301;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const uint = z.bigint();
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const bool = z.boolean();
const text = z.string();

interface EventDescriptor {
  readonly name: string;
  readonly signature: string;
  readonly abi: Abi;
  readonly schema: z.ZodTypeAny;
}

const pairAbi = [parseAbiItem('event Sync(uint112 reserve0, uint112 reserve1)')] as const;

const LASNA_EVENTS: EventDescriptor[] = [
  {
    name: 'RuleCreated',
    signature: 'RuleCreated(address,uint256,uint8,bool)',
    abi: agentAbi,
    schema: z.object({ agent: address, ruleId: uint, template: z.number(), publicRule: bool }),
  },
  {
    name: 'RulePaused',
    signature: 'RulePaused(address,uint256,bool)',
    abi: agentAbi,
    schema: z.object({ agent: address, ruleId: uint, paused: bool }),
  },
  {
    name: 'RuleCancelled',
    signature: 'RuleCancelled(address,uint256)',
    abi: agentAbi,
    schema: z.object({ agent: address, ruleId: uint }),
  },
  {
    name: 'VaultLinked',
    signature: 'VaultLinked(uint256,address)',
    abi: agentAbi,
    schema: z.object({ chainId: uint, vault: address }),
  },
  {
    name: 'RuleEvaluated',
    signature: 'RuleEvaluated(uint256,uint256,bytes32,uint32,bool)',
    abi: agentAbi,
    schema: z.object({
      ruleId: uint,
      originChainId: uint,
      originTxHash: text,
      originLogIndex: z.number(),
      fired: bool,
    }),
  },
  {
    name: 'EvaluationDeferred',
    signature: 'EvaluationDeferred(uint256,uint256)',
    abi: agentAbi,
    schema: z.object({ ruleId: uint, gasRemaining: uint }),
  },
  {
    name: 'BudgetLow',
    signature: 'BudgetLow(uint256,uint256)',
    abi: agentAbi,
    schema: z.object({ reserved: uint, threshold: uint }),
  },
  {
    name: 'AgentDeployed',
    signature: 'AgentDeployed(address,address,uint256)',
    abi: agentFactoryAbi,
    schema: z.object({ owner: address, agent: address, index: uint }),
  },
];

const UNICHAIN_EVENTS: EventDescriptor[] = [
  {
    name: 'VaultDeployed',
    signature: 'VaultDeployed(address,address,address,uint256)',
    abi: vaultFactoryAbi,
    schema: z.object({ owner: address, vault: address, agent: address, chainId: uint }),
  },
  {
    name: 'Executed',
    signature: 'Executed(uint256,address,address,uint256,uint256,uint256)',
    abi: vaultAbi,
    schema: z.object({
      ruleId: uint,
      tokenIn: address,
      tokenOut: address,
      amountIn: uint,
      amountOut: uint,
      timestamp: uint,
    }),
  },
  {
    name: 'Mirrored',
    signature: 'Mirrored(uint256,address,bytes32)',
    abi: vaultAbi,
    schema: z.object({ ruleId: uint, leader: address, leaderTx: text }),
  },
  {
    name: 'Balances',
    signature: 'Balances(address,uint256,address,uint256)',
    abi: vaultAbi,
    schema: z.object({ token0: address, balance0: uint, token1: address, balance1: uint }),
  },
  {
    name: 'Deposited',
    signature: 'Deposited(address,uint256,address)',
    abi: vaultAbi,
    schema: z.object({ token: address, amount: uint, from: address }),
  },
  {
    name: 'Withdrawn',
    signature: 'Withdrawn(address,uint256,address)',
    abi: vaultAbi,
    schema: z.object({ token: address, amount: uint, to: address }),
  },
  {
    name: 'RuleListed',
    signature: 'RuleListed(address,address,uint256,uint8,bytes32,string)',
    abi: ruleRegistryAbi,
    schema: z.object({
      author: address,
      agent: address,
      ruleId: uint,
      template: z.number(),
      paramsHash: text,
      metadataURI: text,
    }),
  },
  {
    name: 'RuleDelisted',
    signature: 'RuleDelisted(address,address,uint256)',
    abi: ruleRegistryAbi,
    schema: z.object({ author: address, agent: address, ruleId: uint }),
  },
  {
    name: 'Sync',
    signature: 'Sync(uint112,uint112)',
    abi: pairAbi,
    schema: z.object({ reserve0: uint, reserve1: uint }),
  },
];

const CATALOG: Readonly<Record<number, EventDescriptor[]>> = {
  [LA]: LASNA_EVENTS,
  [UNI]: UNICHAIN_EVENTS,
};

const BY_SELECTOR = new Map<number, Map<string, EventDescriptor>>(
  Object.entries(CATALOG).map(([chainId, descriptors]) => [
    Number(chainId),
    new Map(descriptors.map((descriptor) => [toEventSelector(descriptor.signature), descriptor])),
  ]),
);

export interface RawLog {
  readonly chainId: number;
  readonly address: `0x${string}`;
  readonly topics: readonly `0x${string}`[];
  readonly data: `0x${string}`;
  readonly blockNumber: bigint;
  readonly transactionHash: `0x${string}`;
  readonly logIndex: number;
  readonly blockTime?: string;
}

export interface DecodedEvent {
  readonly chainId: number;
  readonly name: string;
  readonly address: string;
  readonly blockNumber: bigint;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockTime: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export type DecodeOutcome =
  | { readonly ok: true; readonly event: DecodedEvent }
  | { readonly ok: false; readonly known: boolean; readonly reason: string };

/** True when `topic0` belongs to an event this backend is expected to read. */
export function isKnownTopic(chainId: number, topic0: string): boolean {
  return BY_SELECTOR.get(chainId)?.has(topic0.toLowerCase()) ?? false;
}

/** Decodes one log, then validates its arguments with the event's zod schema. */
export function decodeLog(log: RawLog): DecodeOutcome {
  const topic0 = log.topics[0]?.toLowerCase();
  if (!topic0) return { ok: false, known: false, reason: 'log has no topics' };
  const descriptor = BY_SELECTOR.get(log.chainId)?.get(topic0);
  if (!descriptor) return { ok: false, known: false, reason: 'unknown topic0' };

  try {
    const decoded = decodeEventLog({
      abi: descriptor.abi,
      topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
      data: log.data,
    });
    const parsed = descriptor.schema.safeParse(decoded.args);
    if (!parsed.success) {
      return {
        ok: false,
        known: true,
        reason: `invalid ${descriptor.name} payload: ${parsed.error.message}`,
      };
    }
    return {
      ok: true,
      event: {
        chainId: log.chainId,
        name: descriptor.name,
        address: log.address.toLowerCase(),
        blockNumber: log.blockNumber,
        txHash: log.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
        blockTime: log.blockTime ?? new Date().toISOString(),
        args: parsed.data as Record<string, unknown>,
      },
    };
  } catch (error) {
    return {
      ok: false,
      known: true,
      reason: error instanceof Error ? error.message : 'decode failed',
    };
  }
}

function asString(value: unknown): string {
  return String(value);
}

function asNumber(value: unknown): number {
  return Number(value);
}

/**
 * Persists the read-model rows a decoded event implies. Idempotent by construction: every
 * write uses the primary key from data-model.md §2.
 */
export async function persistDecodedEvent(
  repositories: Repositories,
  event: DecodedEvent,
): Promise<void> {
  const args = event.args;

  switch (event.name) {
    case 'AgentDeployed': {
      await repositories.agents.upsert({
        address: asString(args.agent).toLowerCase(),
        owner: asString(args.owner).toLowerCase(),
        factory: event.address,
        created_tx: event.txHash,
        created_block: asNumber(event.blockNumber),
        rule_count: 0,
        chain_id: event.chainId,
      });
      return;
    }
    case 'VaultDeployed': {
      await repositories.vaults.upsert({
        address: asString(args.vault).toLowerCase(),
        owner: asString(args.owner).toLowerCase(),
        agent: asString(args.agent).toLowerCase(),
        chain_id: asNumber(args.chainId),
        created_tx: event.txHash,
        mirror_mode: false,
        allowed_token_in: null,
        allowed_token_out: null,
        max_spend_per_run: null,
        paused: false,
      });
      return;
    }
    case 'RuleCreated': {
      const agent = asString(args.agent).toLowerCase();
      const ruleId = asString(args.ruleId);
      await repositories.rules.upsert({
        agent,
        rule_id: ruleId,
        template: asNumber(args.template),
        chain_id: UNI,
        status: 'active',
        latched: false,
        pair: null,
        token_in: null,
        token_out: null,
        amount_in: null,
        threshold: null,
        secondary: null,
        last_run_at: null,
        runs: 0,
        is_public: Boolean(args.publicRule),
      });
      await repositories.agents.incrementRuleCount(agent);
      await repositories.ruleEvents.upsert({
        chain_id: event.chainId,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        agent,
        rule_id: ruleId,
        kind: 'created',
        block_time: event.blockTime,
      });
      return;
    }
    case 'RulePaused': {
      const agent = asString(args.agent).toLowerCase();
      const paused = Boolean(args.paused);
      await repositories.rules.updateStatus(
        agent,
        asString(args.ruleId),
        paused ? 'paused' : 'active',
        false,
      );
      await repositories.ruleEvents.upsert({
        chain_id: event.chainId,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        agent,
        rule_id: asString(args.ruleId),
        kind: paused ? 'paused' : 'resumed',
        block_time: event.blockTime,
      });
      return;
    }
    case 'RuleCancelled': {
      const agent = asString(args.agent).toLowerCase();
      await repositories.rules.updateStatus(agent, asString(args.ruleId), 'cancelled', false);
      await repositories.ruleEvents.upsert({
        chain_id: event.chainId,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        agent,
        rule_id: asString(args.ruleId),
        kind: 'cancelled',
        block_time: event.blockTime,
      });
      return;
    }
    case 'RuleEvaluated': {
      const fired = Boolean(args.fired);
      await repositories.ruleEvents.upsert({
        chain_id: event.chainId,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        agent: event.address,
        rule_id: asString(args.ruleId),
        kind: fired ? 'evaluated_fired' : 'evaluated',
        block_time: event.blockTime,
        origin_chain_id: asNumber(args.originChainId),
        origin_tx: asString(args.originTxHash).toLowerCase(),
        origin_log_index: asNumber(args.originLogIndex),
        fired,
      });
      return;
    }
    case 'Executed':
    case 'Mirrored': {
      const vault = await repositories.vaults.get(event.address);
      const ruleId = asString(args.ruleId);
      await repositories.executions.upsert({
        chain_id: event.chainId,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        vault: event.address,
        agent: vault?.agent ?? ZERO_ADDRESS,
        owner: vault?.owner ?? ZERO_ADDRESS,
        rule_id: ruleId,
        kind: event.name === 'Executed' ? 'executed' : 'mirrored',
        token_in: event.name === 'Executed' ? asString(args.tokenIn) : null,
        token_out: event.name === 'Executed' ? asString(args.tokenOut) : null,
        amount_in: event.name === 'Executed' ? asString(args.amountIn) : null,
        amount_out: event.name === 'Executed' ? asString(args.amountOut) : null,
        block_number: asNumber(event.blockNumber),
        block_time: event.blockTime,
        leader_tx: event.name === 'Mirrored' ? asString(args.leaderTx) : null,
        status: 'confirmed',
      });
      return;
    }
    case 'Sync': {
      const reserve0 = args.reserve0 as bigint;
      const reserve1 = args.reserve1 as bigint;
      if (reserve0 === 0n) return;
      await repositories.priceObservations.upsert({
        chain_id: event.chainId,
        pair: event.address,
        block_number: asNumber(event.blockNumber),
        price: ((reserve1 * 10n ** 18n) / reserve0).toString(),
        observed_at: event.blockTime,
      });
      return;
    }
    case 'Deposited': {
      await repositories.sponsorLedger.upsert({
        chain_id: event.chainId,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        target: event.address,
        amount: asString(args.amount),
        asset: asString(args.token),
        block_time: event.blockTime,
      });
      return;
    }
    default:
      return;
  }
}
