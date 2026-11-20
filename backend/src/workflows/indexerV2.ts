import {
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { keccak256, type Address, type PublicClient } from 'viem';

type OriginChain = typeof LASNA_CHAIN_ID | typeof UNICHAIN_SEPOLIA_CHAIN_ID;
export interface WorkflowV2ChainDeployment {
  factory: Address;
  startBlock: number;
}

export interface WorkflowV2Deployment {
  lasna: WorkflowV2ChainDeployment;
  unichain: WorkflowV2ChainDeployment;
}

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

export class WorkflowV2Indexer {
  private stopped = false;
  private readonly deployment: string;
  private readonly sources: ChainSource[];

  constructor(
    private readonly db: SupabaseClient,
    clients: { lasna: PublicClient; unichain: PublicClient },
    config: WorkflowV2Deployment,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.deployment = config.lasna.factory.toLowerCase();
    this.sources = [
      { ...config.lasna, chain: LASNA_CHAIN_ID, client: clients.lasna, confirmations: 20n },
      {
        ...config.unichain,
        chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        client: clients.unichain,
        confirmations: 12n,
      },
    ];
  }

  stop() {
    this.stopped = true;
  }

  async run() {
    while (!this.stopped) {
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
    const lasna = chain === LASNA_CHAIN_ID;
    const [created, events] = await Promise.all([
      client.getLogs({
        address: factory,
        events: lasna ? AGENT_FACTORY : VAULT_CREATED,
        fromBlock,
        toBlock,
        strict: true,
      }),
      client.getLogs({ events: lasna ? AGENT_EVENTS : OUTCOME, fromBlock, toBlock, strict: true }),
    ]);
    const accounts = [];
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
          ).toLowerCase(),
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
    const trusted = await this.trusted(
      chain,
      events.map(({ address }) => address.toLowerCase()),
    );
    const activations = [];
    const runs = [];
    const outcomes = [];
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
        });
      }
    }
    await Promise.all([
      this.upsert('workflow_v2_activations', activations),
      this.upsert('workflow_v2_runs', runs),
      this.upsert('workflow_v2_outcomes', outcomes),
    ]);
    await this.upsert('workflow_v2_cursors', [{ ...scope, block_number: Number(toBlock) }]);
  }

  private async trusted(chain: OriginChain, addresses: string[]) {
    const unique = [...new Set(addresses)];
    const trusted = new Set<string>();
    for (let start = 0; start < unique.length; start += 100) {
      const { data, error } = await this.db
        .from('workflow_v2_accounts')
        .select('address')
        .match({ deployment: this.deployment, chain })
        .in('address', unique.slice(start, start + 100));
      if (error) throw error;
      for (const row of data) trusted.add(row.address);
    }
    return trusted;
  }

  private async upsert(table: string, rows: Record<string, unknown>[]) {
    for (let start = 0; start < rows.length; start += 100) {
      const { error } = await this.db.from(table).upsert(rows.slice(start, start + 100));
      if (error) throw error;
    }
  }
}
