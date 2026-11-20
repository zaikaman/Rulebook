import {
  decodeWorkflow,
  workflowAgentAbi,
  workflowDirectoryAbi,
  workflowTags,
  workflowVaultAbi,
  workflowVaultFactoryAbi,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { decodeEventLog, keccak256, type Address, type Hex, type PublicClient } from 'viem';
import type { ChainClients } from '../chain/clients.js';

export interface WorkflowDeployment {
  readonly directory: Address;
  readonly vaultFactory: Address;
  readonly lasnaStart: number;
  readonly unichainStart: number;
}

const DIRECTORY = workflowDirectoryAbi.filter(
  (item) => item.type === 'event' && item.name !== 'WorkflowCopied',
);
const AGENT = workflowAgentAbi.filter(
  (item) => item.type === 'event' && item.name !== 'WorkflowDisabled',
);
const FACTORY = workflowVaultFactoryAbi.filter((item) => item.type === 'event');
const VAULT = workflowVaultAbi.filter(
  (item) => item.type === 'event' && item.name !== 'WorkflowRevoked',
);

export class WorkflowIndexer {
  private stopped = false;
  constructor(
    private readonly db: SupabaseClient,
    private readonly clients: ChainClients,
    private readonly deployment: WorkflowDeployment,
    private readonly logger: FastifyBaseLogger,
  ) {}

  stop() {
    this.stopped = true;
  }

  async run() {
    while (!this.stopped) {
      const results = await Promise.allSettled([
        this.poll('lasna', 20n),
        this.poll('unichain', 12n),
      ]);
      for (const result of results) {
        if (result.status === 'rejected')
          this.logger.error({ err: result.reason }, 'Workflow indexing failed');
      }
      if (!this.stopped) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  async poll(chain: keyof ChainClients, depth: bigint) {
    const client = this.clients[chain];
    const initial = chain === 'lasna' ? this.deployment.lasnaStart : this.deployment.unichainStart;
    const { data, error } = await this.db
      .from('workflow_index_cursors')
      .select('block_number')
      .eq('chain', chain)
      .maybeSingle();
    if (error) throw error;
    const fromBlock = BigInt(data?.block_number ?? initial - 1) + 1n;
    const head = await client.getBlockNumber();
    if (fromBlock + depth > head) return;
    const toBlock = [fromBlock + 499n, head - depth].reduce((a, b) => (a < b ? a : b));
    if (chain === 'lasna') {
      const logs = await client.getLogs({ events: [...DIRECTORY, ...AGENT], fromBlock, toBlock });
      logs.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
      for (const log of logs) {
        if (log.address.toLowerCase() === this.deployment.directory.toLowerCase()) {
          const event = decodeEventLog({
            abi: DIRECTORY,
            data: log.data,
            topics: log.topics as never,
            strict: true,
          });
          if (event.eventName === 'WorkflowAgentCreated') {
            await this.upsert('workflow_agents', {
              address: event.args.agent.toLowerCase(),
              owner: event.args.owner.toLowerCase(),
            });
          } else if (event.eventName === 'WorkflowPublished') {
            const a = event.args;
            const program = await this.program(client, a.agent, a.programHash);
            const draft = decodeWorkflow(program, a.title);
            await this.upsert('workflow_market_listings', {
              id: a.listingId.toString(),
              agent: a.agent.toLowerCase(),
              author: a.author.toLowerCase(),
              workflow_id: a.workflowId,
              program_hash: a.programHash,
              program,
              title: a.title,
              description: a.description,
              tags: workflowTags(draft),
              trigger: draft.trigger,
              visible: true,
              published_block: Number(log.blockNumber),
            });
          } else if (event.eventName === 'WorkflowUnpublished') {
            const update = await this.db
              .from('workflow_market_listings')
              .update({ visible: false })
              .eq('id', event.args.listingId.toString());
            if (update.error) throw update.error;
          }
          continue;
        }
        const agent = log.address.toLowerCase() as Address;
        if (!(await this.trusted('workflow_agents', agent))) continue;
        const event = decodeEventLog({
          abi: AGENT,
          data: log.data,
          topics: log.topics as never,
          strict: true,
        });
        if (event.eventName === 'WorkflowEnabled') {
          const a = event.args;
          await this.upsert('workflow_activations', {
            agent,
            workflow_id: a.workflowId,
            epoch: a.epoch.toString(),
            program_hash: a.programHash,
            title: a.title,
            source_listing: a.sourceListing.toString(),
          });
        } else if (event.eventName === 'WorkflowDecided') {
          const a = event.args;
          const program = await this.program(client, agent, a.programHash);
          await this.upsert('workflow_decisions', {
            id: a.runId,
            agent,
            workflow_id: a.workflowId,
            program_hash: a.programHash,
            program,
            epoch: a.epoch.toString(),
            leaf: a.leaf,
            observed: a.observed.toString(),
            origin_chain: Number(a.originChain),
            origin_transaction: a.originTransaction,
            origin_log_index: a.originLogIndex.toString(),
            lasna_transaction: log.transactionHash,
            lasna_block: Number(log.blockNumber),
            expires_at: Number(a.expiresAt),
            skipped: a.skipped,
          });
        }
      }
    } else {
      const logs = await client.getLogs({ events: [...FACTORY, ...VAULT], fromBlock, toBlock });
      logs.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
      for (const log of logs) {
        if (log.address.toLowerCase() === this.deployment.vaultFactory.toLowerCase()) {
          const { args } = decodeEventLog({
            abi: FACTORY,
            data: log.data,
            topics: log.topics as never,
            strict: true,
          });
          await this.upsert('workflow_vaults', {
            owner: args.owner.toLowerCase(),
            address: args.vault.toLowerCase(),
            agent: args.agent.toLowerCase(),
          });
          continue;
        }
        const vault = log.address.toLowerCase() as Address;
        if (!(await this.trusted('workflow_vaults', vault))) continue;
        const event = decodeEventLog({
          abi: VAULT,
          data: log.data,
          topics: log.topics as never,
          strict: true,
        });
        if (event.eventName === 'WorkflowAuthorized') {
          const a = event.args;
          await this.upsert('workflow_authorizations', {
            vault,
            workflow_id: a.workflowId,
            epoch: a.epoch.toString(),
            program_hash: a.programHash,
          });
        } else if (event.eventName === 'WorkflowOutcome') {
          const a = event.args;
          const { error: insertError } = await this.db.from('workflow_outcomes').upsert(
            {
              id: a.runId,
              vault,
              workflow_id: a.workflowId,
              program_hash: a.programHash,
              epoch: a.epoch.toString(),
              leaf: a.leaf,
              destination_transaction: log.transactionHash,
              completed: a.completed,
              reason: a.reason,
            },
            { onConflict: 'id', ignoreDuplicates: true },
          );
          if (insertError) throw insertError;
        } else if (event.eventName === 'WorkflowStep') {
          const a = event.args;
          await this.upsert('workflow_steps', {
            id: a.runId,
            step: a.step,
            vault,
            destination_transaction: log.transactionHash,
            kind: a.kind,
            amount: a.amount.toString(),
            received: a.received.toString(),
            recipient: a.recipient,
          });
        }
      }
    }
    await this.upsert('workflow_index_cursors', { chain, block_number: Number(toBlock) });
  }

  private async program(client: PublicClient, agent: Address, hash: Hex) {
    const program = await client.readContract({
      address: agent,
      abi: workflowAgentAbi,
      functionName: 'programByHash',
      args: [hash],
    });
    if (keccak256(program) !== hash) throw new Error('Indexed workflow hash mismatch');
    return program;
  }

  private async trusted(table: 'workflow_agents' | 'workflow_vaults', address: Address) {
    const query = await this.db.from(table).select('address').eq('address', address).maybeSingle();
    if (query.error) throw query.error;
    return Boolean(query.data);
  }

  private async upsert(table: string, row: Record<string, unknown>) {
    const { error } = await this.db.from(table).upsert(row);
    if (error) throw error;
  }
}
