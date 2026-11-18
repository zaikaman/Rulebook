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
const txHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

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
    name: 'MirrorAttached',
    signature: 'MirrorAttached(uint256,address,address,uint256,uint16,uint256,uint8)',
    abi: agentAbi,
    schema: z.object({
      ruleId: uint,
      leaderAgent: address,
      leaderVault: address,
      leaderRuleId: uint,
      scaleBps: z.number().int().min(1).max(10_000),
      perRunCap: uint,
      hourlyCap: z.number().int().min(1).max(10),
    }),
  },
  {
    name: 'MirrorDetached',
    signature: 'MirrorDetached(uint256)',
    abi: agentAbi,
    schema: z.object({ ruleId: uint }),
  },
  {
    name: 'MirrorCallbackRequested',
    signature: 'MirrorCallbackRequested(bytes32,address,uint256)',
    abi: agentAbi,
    schema: z.object({ leaderTx: txHash, leaderVault: address, ruleId: uint }),
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
    name: 'AlertRaised',
    signature: 'AlertRaised(uint256,uint8,uint256)',
    abi: agentAbi,
    schema: z.object({ ruleId: uint, template: z.number(), observed: uint }),
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
    name: 'MirrorVaultDeployed',
    signature: 'MirrorVaultDeployed(address)',
    abi: vaultFactoryAbi,
    schema: z.object({ vault: address }),
  },
  {
    name: 'Mirrored',
    signature: 'Mirrored(uint256,address,bytes32)',
    abi: vaultAbi,
    schema: z.object({ ruleId: uint, leader: address, leaderTx: txHash }),
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
 * The rule parameters `Agent.getRule` returns, used to backfill a rule the indexer learned
 * about from an event. Only the fields the read model stores are kept.
 */
export interface RuleSnapshot {
  readonly template: number;
  readonly chainId: number;
  readonly pair: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: string;
  readonly threshold: string;
  readonly secondary: string;
}

/** Reads one stored rule from its Agent; absent in tests that do not need a chain read. */
export type RuleReader = (
  chainId: number,
  agent: string,
  ruleId: bigint,
) => Promise<RuleSnapshot | null>;

export interface PersistOptions {
  readonly readRule?: RuleReader;
}

/**
 * Persists the read-model rows a decoded event implies. Idempotent by construction: every
 * write uses the primary key from data-model.md §2.
 */
export async function persistDecodedEvent(
  repositories: Repositories,
  event: DecodedEvent,
  options: PersistOptions = {},
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
      const address = asString(args.vault).toLowerCase();
      const previous = await repositories.vaults.get(address);
      await repositories.vaults.upsert({
        address,
        owner: asString(args.owner).toLowerCase(),
        agent: asString(args.agent).toLowerCase(),
        chain_id: asNumber(args.chainId),
        created_tx: event.txHash,
        mirror_mode: previous?.mirror_mode ?? false,
        allowed_token_in: previous?.allowed_token_in ?? null,
        allowed_token_out: previous?.allowed_token_out ?? null,
        max_spend_per_run: previous?.max_spend_per_run ?? null,
        paused: previous?.paused ?? false,
      });
      return;
    }
    case 'MirrorVaultDeployed': {
      const vault = await repositories.vaults.get(asString(args.vault).toLowerCase());
      if (vault && vault.created_tx === event.txHash) {
        await repositories.vaults.markMirror(vault.address);
      }
      return;
    }
    case 'MirrorAttached': {
      if (!(await repositories.agents.get(event.address))) return;
      await repositories.mirrors.upsert({
        follower_agent: event.address,
        rule_id: asString(args.ruleId),
        leader_agent: asString(args.leaderAgent).toLowerCase(),
        leader_rule_id: asString(args.leaderRuleId),
        leader_vault: asString(args.leaderVault).toLowerCase(),
        scale_bps: asNumber(args.scaleBps),
        per_run_cap: asString(args.perRunCap),
        hourly_cap: asNumber(args.hourlyCap),
        detached_at: null,
      });
      return;
    }
    case 'MirrorDetached': {
      await repositories.mirrors.detach(event.address, asString(args.ruleId), event.blockTime);
      return;
    }
    case 'MirrorCallbackRequested': {
      if (!(await repositories.agents.get(event.address))) return;
      await repositories.ruleEvents.upsert({
        chain_id: event.chainId,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        agent: event.address,
        rule_id: asString(args.ruleId),
        kind: 'mirror_callback_requested',
        block_time: event.blockTime,
        origin_chain_id: UNI,
        origin_tx: asString(args.leaderTx).toLowerCase(),
      });
      return;
    }
    case 'RuleCreated': {
      const agent = asString(args.agent).toLowerCase();
      const ruleId = asString(args.ruleId);
      const snapshot = options.readRule
        ? await options.readRule(event.chainId, agent, args.ruleId as bigint).catch(() => null)
        : null;
      await repositories.rules.upsert({
        agent,
        rule_id: ruleId,
        template: asNumber(args.template),
        chain_id: snapshot?.chainId ?? UNI,
        status: 'active',
        latched: false,
        pair: snapshot?.pair ?? null,
        token_in: snapshot?.tokenIn ?? null,
        token_out: snapshot?.tokenOut ?? null,
        amount_in: snapshot?.amountIn ?? null,
        threshold: snapshot?.threshold ?? null,
        secondary: snapshot?.secondary ?? null,
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
    case 'RuleListed': {
      const agent = asString(args.agent).toLowerCase();
      const ruleId = asString(args.ruleId);
      await repositories.listings.upsert({
        chain_id: event.chainId,
        listing_id: ruleId,
        agent,
        rule_id: ruleId,
        template: asNumber(args.template),
        metadata_uri: asString(args.metadataURI),
        is_public: true,
        author: asString(args.author).toLowerCase(),
        author_badge: 'community',
        name: null,
        description: null,
        params_hash: asString(args.paramsHash).toLowerCase(),
        created_at: event.blockTime,
      });
      await repositories.rules.setPublic(agent, ruleId, true);
      return;
    }
    case 'RuleDelisted': {
      const agent = asString(args.agent).toLowerCase();
      const ruleId = asString(args.ruleId);
      await repositories.listings.setPublic(event.chainId, agent, ruleId, false);
      await repositories.rules.setPublic(agent, ruleId, false);
      return;
    }
    case 'RulePaused': {
      const agent = asString(args.agent).toLowerCase();
      const paused = Boolean(args.paused);
      // Pausing does not erase a latch; resuming does not fake an unfired state.
      await repositories.rules.updateStatus(
        agent,
        asString(args.ruleId),
        paused ? 'paused' : 'active',
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
    case 'AlertRaised': {
      // An alert is an activity row, never an execution: nothing moved, so no `Executed`.
      await repositories.ruleEvents.upsert({
        chain_id: event.chainId,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        agent: event.address,
        rule_id: asString(args.ruleId),
        kind: 'alert',
        block_time: event.blockTime,
      });
      return;
    }
    case 'Executed':
    case 'Mirrored': {
      const vault = await repositories.vaults.get(event.address);
      if (event.name === 'Mirrored' && !vault?.mirror_mode) return;
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
        leader_tx: event.name === 'Mirrored' ? asString(args.leaderTx).toLowerCase() : null,
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
