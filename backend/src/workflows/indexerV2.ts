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

export class WorkflowV2Indexer {
  private stopped = false;
  private readonly deployment: string;
  private readonly sources: ChainSource[];

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
    while (!this.stopped) {
      await this.syncOnce();
      if (!this.stopped) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  private async poll(source: ChainSource) {
    const { chain, client, confirmations, factory, startBlock } = source;
    const scope = { deployment: this.deployment, chain };
    const { data, error } = await this.db
      .from('workflow_v2_cursors')
      .select('block_number')
      .match(scope)
      .maybeSingle();
    if (error) throw error;
    const fromBlock = BigInt(data?.block_number ?? startBlock - 1) + 1n;
    const head = (await client.getBlockNumber({ cacheTime: 0 })) - confirmations;
    if (fromBlock > head) return;
    const toBlock = fromBlock + 199n < head ? fromBlock + 199n : head;
    const lasna = isAutomationChain(chain);
    const created = await client.getLogs({
      address: factory,
      events: lasna ? AGENT_FACTORY : VAULT_CREATED,
      fromBlock,
      toBlock,
      strict: true,
    });
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
    const fetchBatch = (address: Address[]) =>
      client.getLogs({
        address,
        events: lasna ? AGENT_EVENTS : OUTCOME,
        fromBlock,
        toBlock,
        strict: true,
      });
    const batches: Array<Awaited<ReturnType<typeof fetchBatch>>> = [];
    for (let start = 0; start < known.length; start += ADDRESS_BATCH_SIZE) {
      batches.push(await fetchBatch(known.slice(start, start + ADDRESS_BATCH_SIZE)));
    }
    const events = batches
      .flat()
      .sort(
        (first, second) =>
          Number(first.blockNumber - second.blockNumber) || first.logIndex - second.logIndex,
      );
    const trusted = new Set<string>(known);
    const activations = [];
    const runs = [];
    const outcomes = [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const blockTimes = new Map<bigint, number>();
    async function timeAt(blockNumber: bigint) {
      const cached = blockTimes.get(blockNumber);
      if (cached !== undefined) return cached;
      const block = await client.getBlock({ blockNumber });
      const time = Number(block.timestamp) * 1000;
      blockTimes.set(blockNumber, time);
      return time;
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
    await this.upsert('workflow_v2_cursors', [
      {
        ...scope,
        block_number: Number(toBlock),
        ...(this.stageTelegram
          ? { block_time: new Date(await timeAt(toBlock)).toISOString() }
          : {}),
      },
    ]);
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
