import { setTimeout as pause } from 'node:timers/promises';

import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  isAutomationChain,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowDeploymentKey,
  type WorkflowV2ChainDeployment,
  type WorkflowV2Deployment,
  type WorkflowV2MainnetDeployment,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { keccak256, type Address, type PublicClient } from 'viem';

const ADDRESS_BATCH_SIZE = 50;
const ACCOUNT_PAGE_SIZE = 1000;
const IDLE_POLL_MS = 5_000;

type OriginChain =
  | typeof LASNA_CHAIN_ID
  | typeof UNICHAIN_SEPOLIA_CHAIN_ID
  | typeof BASE_SEPOLIA_CHAIN_ID
  | typeof REACTIVE_MAINNET_CHAIN_ID
  | typeof UNICHAIN_MAINNET_CHAIN_ID
  | typeof BASE_MAINNET_CHAIN_ID;
export type { WorkflowV2ChainDeployment, WorkflowV2Deployment, WorkflowV2MainnetDeployment };

interface ChainSource extends WorkflowV2ChainDeployment {
  chain: OriginChain;
  client: PublicClient;
  confirmations: bigint;
}

const AGENT_FACTORY = workflowAgentFactoryV2Abi.filter((item) => item.type === 'event');
const VAULT_CREATED = workflowVaultFactoryV2Abi.filter((item) => item.type === 'event');
const AGENT_EVENTS = workflowAgentV2Abi.filter(
  (item) => item.type === 'event' && (item.name === 'Enabled' || item.name === 'Dispatched'),
);
const OUTCOME = workflowVaultV2Abi.filter(
  (item) => item.type === 'event' && item.name === 'Outcome',
);
const telegramOutcomes = new Set([1, 3, 4, 6]);

function defaultMaxRange(chain: OriginChain): bigint {
  return isAutomationChain(chain) ? 500n : 2_000n;
}

export class WorkflowV2Indexer {
  private stopped = false;
  private readonly abort = new AbortController();
  private readonly deployment: string;
  private readonly sources: ChainSource[];
  private readonly rangeByChain = new Map<OriginChain, bigint>();

  constructor(
    private readonly db: SupabaseClient,
    clients: {
      lasna: PublicClient;
      unichain: PublicClient;
      base?: PublicClient;
      reactiveMainnet?: PublicClient;
      unichainMainnet?: PublicClient;
      baseMainnet?: PublicClient;
    },
    config: WorkflowV2Deployment | WorkflowV2MainnetDeployment,
    private readonly logger: FastifyBaseLogger,
    private readonly stageTelegram = false,
  ) {
    if ('reactive' in config) {
      if (!clients.reactiveMainnet || !clients.unichainMainnet) {
        throw new Error('Mainnet RPC clients must be configured to index the mainnet deployment.');
      }
      this.deployment = workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, config.reactive.factory);
      this.sources = [
        {
          ...config.reactive,
          chain: REACTIVE_MAINNET_CHAIN_ID,
          client: clients.reactiveMainnet,
          confirmations: 20n,
        },
        {
          ...config.unichain,
          chain: UNICHAIN_MAINNET_CHAIN_ID,
          client: clients.unichainMainnet,
          confirmations: 12n,
        },
      ];
      if (config.base && clients.baseMainnet) {
        this.sources.push({
          ...config.base,
          chain: BASE_MAINNET_CHAIN_ID,
          client: clients.baseMainnet,
          confirmations: 12n,
        });
      }
      return;
    }
    this.deployment = workflowDeploymentKey(LASNA_CHAIN_ID, config.lasna.factory);
    this.sources = [
      { ...config.lasna, chain: LASNA_CHAIN_ID, client: clients.lasna, confirmations: 20n },
      {
        ...config.unichain,
        chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        client: clients.unichain,
        confirmations: 12n,
      },
    ];
    if (config.base && clients.base) {
      this.sources.push({
        ...config.base,
        chain: BASE_SEPOLIA_CHAIN_ID,
        client: clients.base,
        confirmations: 12n,
      });
    }
  }

  stop() {
    this.stopped = true;
    this.abort.abort();
  }

  async syncOnce(): Promise<void> {
    await Promise.all(
      this.sources.map(async (source) => {
        try {
          await this.poll(source);
        } catch (err) {
          this.logger.error(
            { err, chain: source.chain, deployment: this.deployment },
            'Workflow V2 indexing failed',
          );
        }
      }),
    );
  }

  async run() {
    await Promise.all(this.sources.map((source) => this.runSource(source)));
  }

  private async runSource(source: ChainSource) {
    while (!this.stopped) {
      let caughtUp = true;
      try {
        ({ caughtUp } = await this.poll(source));
      } catch (err) {
        this.logger.error(
          { err, chain: source.chain, deployment: this.deployment },
          'Workflow V2 indexing failed',
        );
      }
      if (!this.stopped && caughtUp) {
        await pause(IDLE_POLL_MS, undefined, { signal: this.abort.signal }).catch(() => undefined);
      }
    }
  }

  private async rewindAfterReorg(source: ChainSource, previousBlock: bigint): Promise<void> {
    const floor = BigInt(source.startBlock) - 1n;
    const candidate = previousBlock - source.confirmations * 2n;
    const rewindTo = candidate > floor ? candidate : floor;
    const scope = { deployment: this.deployment, chain: source.chain };

    const deleteResults = await Promise.all([
      ...(!isAutomationChain(source.chain)
        ? [
            this.db
              .from('workflow_v2_outcomes')
              .delete()
              .match(scope)
              .gt('block_number', Number(rewindTo)),
          ]
        : [
            this.db
              .from('workflow_v2_market_listings')
              .delete()
              .eq('deployment', this.deployment)
              .gt('block_number', Number(rewindTo)),
            this.db
              .from('workflow_v2_runs')
              .delete()
              .eq('deployment', this.deployment)
              .gt('lasna_block', Number(rewindTo)),
          ]),
    ]);
    for (const result of deleteResults) {
      if (result.error) throw result.error;
    }

    await this.upsert('workflow_v2_cursors', [
      {
        ...scope,
        block_number: Number(rewindTo),
        block_hash: null,
        updated_at: new Date().toISOString(),
      },
    ]);
  }

  private async poll(source: ChainSource): Promise<{ caughtUp: boolean }> {
    const { chain, client, confirmations, factory, startBlock } = source;
    const scope = { deployment: this.deployment, chain };
    const { data, error } = await this.db
      .from('workflow_v2_cursors')
      .select('block_number,block_hash')
      .match(scope)
      .maybeSingle();
    if (error) throw error;

    const cursorBlock =
      data?.block_number !== undefined && data?.block_number !== null
        ? BigInt(data.block_number)
        : undefined;
    if (cursorBlock !== undefined && data?.block_hash && typeof client.getBlock === 'function') {
      const currentBlock = await client.getBlock({ blockNumber: cursorBlock }).catch(() => null);
      if (
        currentBlock?.hash &&
        currentBlock.hash.toLowerCase() !== String(data.block_hash).toLowerCase()
      ) {
        this.logger.warn(
          {
            chain,
            deployment: this.deployment,
            blockNumber: Number(cursorBlock),
            expectedHash: data.block_hash,
            actualHash: currentBlock.hash,
          },
          'Workflow V2 reorg detected; rewinding cursor',
        );
        await this.rewindAfterReorg(source, cursorBlock);
        return { caughtUp: false };
      }
    }

    const fromBlock = (cursorBlock ?? BigInt(startBlock - 1)) + 1n;
    const head = (await client.getBlockNumber({ cacheTime: 0 })) - confirmations;
    if (fromBlock > head) return { caughtUp: true };

    const maxSpan = this.rangeByChain.get(chain) ?? defaultMaxRange(chain);
    const initialToBlock = fromBlock + maxSpan - 1n < head ? fromBlock + maxSpan - 1n : head;
    const lasna = isAutomationChain(chain);

    const { toBlock, created } = await this.fetchFactoryLogsAdaptive(
      source,
      factory,
      lasna ? AGENT_FACTORY : VAULT_CREATED,
      fromBlock,
      initialToBlock,
    );

    const accounts: Array<{
      deployment: string;
      chain: OriginChain;
      address: Address;
      owner: string;
      agent: string;
    }> = [];
    created.sort(
      (first, second) =>
        Number(first.blockNumber - second.blockNumber) || first.logIndex - second.logIndex,
    );
    for (const log of created) {
      if (log.eventName === 'AgentCreated' || log.eventName === 'VaultCreated') {
        accounts.push({
          ...scope,
          address: (log.eventName === 'AgentCreated'
            ? log.args.agent
            : log.args.vault
          ).toLowerCase() as Address,
          owner: log.args.owner.toLowerCase(),
          agent: log.args.agent.toLowerCase(),
        });
      } else if (log.eventName === 'Published') {
        const a = log.args;
        const program = await client.readContract({
          address: a.agent,
          abi: workflowAgentV2Abi,
          functionName: 'programs',
          args: [a.programHash],
        });
        if (keccak256(program) !== a.programHash)
          throw new Error('V2 listing program hash mismatch.');
        await this.upsert('workflow_v2_market_listings', [
          {
            deployment: this.deployment,
            chain: a.chain,
            id: a.listing.toString(),
            owner: a.owner.toLowerCase(),
            agent: a.agent.toLowerCase(),
            workflow_id: a.workflow,
            program_hash: a.programHash,
            program,
            title: a.title,
            description: a.description,
            visible: true,
            block_number: Number(log.blockNumber),
            log_index: log.logIndex,
          },
        ]);
      } else {
        const result = await this.db
          .from('workflow_v2_market_listings')
          .update({ visible: false })
          .match({ deployment: this.deployment, id: log.args.listing.toString() });
        if (result.error) throw result.error;
      }
    }
    await this.upsert('workflow_v2_accounts', accounts);
    const known = await this.knownAddresses(
      chain,
      accounts.map((row) => row.address),
    );
    const rawEvents = await this.fetchKnownLogs(
      source,
      known,
      lasna ? AGENT_EVENTS : OUTCOME,
      fromBlock,
      toBlock,
    );
    const events = rawEvents.sort(
      (first, second) =>
        Number(first.blockNumber - second.blockNumber) || first.logIndex - second.logIndex,
    );
    const trusted = new Set<string>(known);
    const activations = [];
    const runs = [];
    const outcomes = [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const blockHeaders = new Map<bigint, { time: number; hash: string | null }>();
    async function headerAt(blockNumber: bigint) {
      const cached = blockHeaders.get(blockNumber);
      if (cached !== undefined) return cached;
      const block = await client.getBlock({ blockNumber });
      const entry = {
        time: Number(block.timestamp) * 1000,
        hash: typeof block.hash === 'string' ? block.hash.toLowerCase() : null,
      };
      blockHeaders.set(blockNumber, entry);
      return entry;
    }
    async function timeAt(blockNumber: bigint) {
      return (await headerAt(blockNumber)).time;
    }
    // A backfill range entirely outside the delivery window needs no per-event header reads.
    const stageTelegram =
      this.stageTelegram &&
      events.some(
        (log) =>
          log.eventName === 'Outcome' &&
          telegramOutcomes.has(log.args.status) &&
          trusted.has(log.address.toLowerCase()),
      ) &&
      (await timeAt(toBlock)) > cutoff;
    for (const log of events) {
      const address = log.address.toLowerCase();
      if (!trusted.has(address)) continue;
      const row = {
        deployment: this.deployment,
        workflow_id: log.args.workflow,
        epoch: log.args.epoch.toString(),
      };
      if (log.eventName === 'Enabled') {
        activations.push({
          ...row,
          chain: log.args.chain,
          agent: address,
          program_hash: log.args.programHash,
          title: log.args.title,
        });
      } else if (log.eventName === 'Dispatched') {
        const a = log.args;
        runs.push({
          ...row,
          chain: a.chain,
          id: a.runId,
          agent: address,
          program_hash: a.programHash,
          origin_chain: a.originChain,
          origin_transaction: a.originTransaction,
          origin_log_index: a.originLogIndex.toString(),
          lasna_transaction: log.transactionHash,
          lasna_block: Number(log.blockNumber),
          expires_at: Number(a.expiresAt),
        });
      } else {
        const blockTime =
          stageTelegram && telegramOutcomes.has(log.args.status)
            ? await timeAt(log.blockNumber)
            : 0;
        outcomes.push({
          ...row,
          chain,
          vault: address,
          run_id: log.args.runId,
          transaction_hash: log.transactionHash,
          block_number: Number(log.blockNumber),
          log_index: log.logIndex,
          status: log.args.status,
          path: log.args.path === 255 ? null : log.args.path,
          reason: log.args.reason,
          ...(blockTime > cutoff ? { telegram_block_time: new Date(blockTime).toISOString() } : {}),
        });
      }
    }
    await Promise.all([
      this.upsert('workflow_v2_activations', activations),
      this.upsert('workflow_v2_runs', runs),
      this.upsert('workflow_v2_outcomes', outcomes),
    ]);

    const cursorHeader =
      typeof client.getBlock === 'function' ? await headerAt(toBlock).catch(() => null) : null;
    await this.upsert('workflow_v2_cursors', [
      {
        ...scope,
        block_number: Number(toBlock),
        ...(cursorHeader?.hash ? { block_hash: cursorHeader.hash } : {}),
        updated_at: new Date().toISOString(),
        ...(this.stageTelegram && cursorHeader
          ? { block_time: new Date(cursorHeader.time).toISOString() }
          : {}),
      },
    ]);
    return { caughtUp: toBlock >= head };
  }

  private async fetchFactoryLogsAdaptive(
    source: ChainSource,
    factory: Address,
    events: typeof AGENT_FACTORY | typeof VAULT_CREATED,
    fromBlock: bigint,
    initialToBlock: bigint,
  ) {
    let toBlock = initialToBlock;
    while (true) {
      try {
        const created = await source.client.getLogs({
          address: factory,
          events,
          fromBlock,
          toBlock,
          strict: true,
        });
        const span = toBlock - fromBlock + 1n;
        const limit = this.rangeByChain.get(source.chain) ?? defaultMaxRange(source.chain);
        if (toBlock === initialToBlock && span === limit && limit < defaultMaxRange(source.chain)) {
          const grown = limit * 2n;
          const cap = defaultMaxRange(source.chain);
          this.rangeByChain.set(source.chain, grown < cap ? grown : cap);
        }
        return { toBlock, created };
      } catch (err) {
        if (toBlock <= fromBlock) throw err;
        const half = (toBlock - fromBlock + 1n) / 2n;
        const nextSpan = half > 0n ? half : 1n;
        toBlock = fromBlock + nextSpan - 1n;
        this.rangeByChain.set(source.chain, nextSpan);
      }
    }
  }

  private async fetchKnownLogs(
    source: ChainSource,
    known: readonly Address[],
    events: typeof AGENT_EVENTS | typeof OUTCOME,
    fromBlock: bigint,
    toBlock: bigint,
  ) {
    const readLogs = (addresses: Address[], startBlock: bigint, endBlock: bigint) =>
      source.client.getLogs({
        address: addresses,
        events,
        fromBlock: startBlock,
        toBlock: endBlock,
        strict: true,
      });
    type KnownLogs = Awaited<ReturnType<typeof readLogs>>;

    const fetchChunk = async (
      addresses: readonly Address[],
      startBlock: bigint,
      endBlock: bigint,
    ): Promise<KnownLogs> => {
      if (addresses.length === 0) return [];
      try {
        return await readLogs([...addresses], startBlock, endBlock);
      } catch (err) {
        if (addresses.length > 1) {
          const mid = Math.ceil(addresses.length / 2);
          const left = await fetchChunk(addresses.slice(0, mid), startBlock, endBlock);
          const right = await fetchChunk(addresses.slice(mid), startBlock, endBlock);
          return [...left, ...right] as KnownLogs;
        }
        if (endBlock > startBlock) {
          const mid = startBlock + (endBlock - startBlock) / 2n;
          const left = await fetchChunk(addresses, startBlock, mid);
          const right = await fetchChunk(addresses, mid + 1n, endBlock);
          return [...left, ...right] as KnownLogs;
        }
        throw err;
      }
    };

    const collected: KnownLogs[number][] = [];
    for (let start = 0; start < known.length; start += ADDRESS_BATCH_SIZE) {
      const batch = await fetchChunk(
        known.slice(start, start + ADDRESS_BATCH_SIZE),
        fromBlock,
        toBlock,
      );
      collected.push(...batch);
    }
    return collected;
  }

  private async knownAddresses(chain: OriginChain, extraAddresses: readonly Address[]) {
    const known = new Set<Address>(
      extraAddresses.map((address) => address.toLowerCase() as Address),
    );
    for (let offset = 0; ; offset += ACCOUNT_PAGE_SIZE) {
      const { data, error } = await this.db
        .from('workflow_v2_accounts')
        .select('address')
        .match({ deployment: this.deployment, chain })
        .order('address', { ascending: true })
        .range(offset, offset + ACCOUNT_PAGE_SIZE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        known.add(String(row.address).toLowerCase() as Address);
      }
      if (!data || data.length < ACCOUNT_PAGE_SIZE) break;
    }
    return [...known];
  }

  private async upsert(table: string, rows: Record<string, unknown>[]) {
    for (let start = 0; start < rows.length; start += 100) {
      const { error } = await this.db.from(table).upsert(rows.slice(start, start + 100));
      if (error) throw error;
    }
  }
}
