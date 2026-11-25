import {
  addressSchema,
  decodeWorkflowV2,
  fundsChainIdSchema,
  getChain,
  isFundsChain,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowIdSchema,
  workflowV2Action,
  workflowV2Trigger,
  workflowVaultV2Abi,
  type Address,
  type FundsChainId,
} from '@rulebook/shared';
import { erc20Abi, formatUnits, parseEventLogs, type PublicClient } from 'viem';
import { z } from 'zod';

import { clientFor, type ChainClients } from '../chain/clients.js';
import { workflowV2FailureReason } from '../workflows/failureReasons.js';
import type { TelegramDatabase } from './service.js';

const events = workflowVaultV2Abi.filter(
  (item) => item.type === 'event' && (item.name === 'Step' || item.name === 'Observation'),
);
const epochSchema = z.string().regex(/^\d+$/);
const unixTime = z.number().int().positive().safe();
const candidates = z.array(
  z.object({
    transaction_hash: workflowIdSchema,
    log_index: z.number().int(),
    block_number: z.number().int().safe(),
    vault: addressSchema,
    run_id: workflowIdSchema,
    workflow_id: workflowIdSchema,
    program_hash: workflowIdSchema,
    origin_chain: z.number().int(),
    origin_transaction: workflowIdSchema,
    origin_log_index: z.string().regex(/^\d+$/),
    epoch: epochSchema,
    status: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(6)]),
    reason: z.string(),
    title: z.string(),
    eligible: z.boolean(),
  }),
);
type Candidate = z.infer<typeof candidates>[number];

export const payoutPreflight = z.object({
  kind: z.literal('payout'),
  chain: fundsChainIdSchema.default(UNICHAIN_SEPOLIA_CHAIN_ID),
  vault: addressSchema,
  workflow: workflowIdSchema,
  epoch: epochSchema,
  deadline: unixTime,
  block: epochSchema,
});

async function payoutDeadline(
  client: PublicClient,
  vault: Address,
  workflow: z.infer<typeof workflowIdSchema>,
  epoch: string,
  blockNumber: bigint,
) {
  const call = { address: vault, abi: workflowVaultV2Abi, args: [workflow], blockNumber } as const;
  const [auth, memory] = await Promise.all([
    client.readContract({ ...call, functionName: 'authorizations' }),
    client.readContract({ ...call, functionName: 'workflowMemory' }),
  ]);
  return auth[3] && auth[1].toString() === epoch && !memory[7] ? Number(memory[4]) : 0;
}

const usdc = (amount: bigint) => `${formatUnits(amount, 6)} USDC`;
const weth = (amount: bigint) => `${formatUnits(amount, 18)} WETH`;

export class WorkflowTelegramAlerts {
  private readonly clients: ChainClients;

  constructor(
    private readonly db: Pick<TelegramDatabase, 'rpc'>,
    clientsOrClient: ChainClients | PublicClient,
    readonly deployment: Address,
    private readonly origin: string,
    private readonly chains: readonly FundsChainId[] = [UNICHAIN_SEPOLIA_CHAIN_ID],
  ) {
    this.clients =
      'lasna' in clientsOrClient
        ? clientsOrClient
        : { lasna: clientsOrClient, unichain: clientsOrClient, base: clientsOrClient };
  }

  async process() {
    let failed = false;
    for (const chain of this.chains) {
      const rows = await this.db.rpc(
        'telegram_workflow_candidates',
        { p_deployment: this.deployment, p_chain: chain },
        candidates,
      );
      // Bound RPC concurrency while a backlog is draining.
      for (let offset = 0; offset < rows.length; offset += 5) {
        const results = await Promise.allSettled(
          rows.slice(offset, offset + 5).map((row) => this.stage(chain, row)),
        );
        if (results.some(({ status }) => status === 'rejected')) failed = true;
      }
    }
    await this.db.rpc(
      'telegram_queue_payout_warnings',
      { p_deployment: this.deployment },
      z.null(),
    );
    if (failed) throw new Error('Some workflow Telegram alerts were deferred');
  }

  async processUnfinished() {
    for (const chain of this.chains) {
      await this.db.rpc(
        'telegram_process_unfinished',
        { p_deployment: this.deployment, p_chain: chain, p_origin: this.origin },
        z.null(),
      );
    }
  }

  async stillInGrace(input: z.infer<typeof payoutPreflight>) {
    const client = clientFor(this.clients, input.chain);
    const block = await client.getBlock({ blockTag: 'latest' });
    if (block.number < BigInt(input.block) || Date.now() / 1000 - Number(block.timestamp) > 300)
      throw new Error('Payout RPC is stale');
    return (
      BigInt(input.deadline) > block.timestamp &&
      (await payoutDeadline(client, input.vault, input.workflow, input.epoch, block.number)) ===
        input.deadline
    );
  }

  private async stage(chain: FundsChainId, row: Candidate) {
    const key = {
      p_deployment: this.deployment,
      p_chain: chain,
      p_tx: row.transaction_hash,
      p_index: row.log_index,
    };
    const client = clientFor(this.clients, chain);
    try {
      const deadline =
        row.eligible && row.status === 6
          ? await payoutDeadline(
              client,
              row.vault,
              row.workflow_id,
              row.epoch,
              BigInt(row.block_number),
            )
          : 0;
      const message = row.eligible ? await this.message(chain, row, deadline) : null;
      await this.db.rpc(
        'telegram_complete_workflow',
        { ...key, p_message: message, p_deadline: deadline || null },
        z.null(),
      );
    } catch (error) {
      await this.db.rpc('telegram_defer_workflow', key, z.null());
      throw error;
    }
  }

  private async message(chain: FundsChainId, row: Candidate, deadline: number) {
    const title = row.title.replace(/[\p{C}\s]+/gu, ' ').trim();
    const run = `${this.origin}/runs/${row.run_id}`;
    const workflow = `${this.origin}/workflows/${row.workflow_id}`;
    const tx = `${getChain(chain).explorerUrl}/tx/${row.transaction_hash}`;
    if (row.status === 6) {
      if (deadline * 1000 <= Date.now()) return null;
      const at = new Date(deadline * 1000).toISOString().slice(0, 16).replace('T', ' ');
      return [
        'Rulebook · Inactivity payout warning',
        title,
        `The payout can happen from ${at} UTC. Open the workflow and choose Check in to clear it.`,
        workflow,
      ].join('\n');
    }
    if (row.status === 4) {
      const { message, recovery } = workflowV2FailureReason(row.reason);
      const account = `${this.origin}/account`;
      const next = {
        balances: ['Check your wallet and Vault balances in Account & Vault.', account],
        allowance: ['Review the Vault’s USDC allowance in Account & Vault.', account],
        limits: ['Review the approved spending limit on the workflow.', workflow],
      };
      return [
        'Rulebook · Workflow run failed',
        title,
        message,
        ...(recovery ? next[recovery] : []),
        run,
        tx,
      ].join('\n');
    }
    if (row.status === 3) {
      return [
        'Rulebook · Workflow run expired',
        title,
        'The Vault recorded an expired run.',
        run,
        tx,
      ].join('\n');
    }
    const details = await this.receiptDetails(chain, row);
    return [
      details.alert ? 'Rulebook · Workflow alert' : 'Rulebook · Workflow confirmed',
      title,
      ...details.lines,
      run,
      tx,
    ].join('\n');
  }

  private async receiptDetails(chain: FundsChainId, row: Candidate) {
    const client = clientFor(this.clients, chain);
    const receipt = await client.getTransactionReceipt({ hash: row.transaction_hash });
    if (receipt.blockNumber !== BigInt(row.block_number))
      throw new Error('Workflow receipt block changed');
    const logs = parseEventLogs({
      abi: events,
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === row.vault),
    }).filter((log) => log.args.runId === row.run_id);
    const observation = logs.find((log) => log.eventName === 'Observation');
    const steps = logs
      .filter((log) => log.eventName === 'Step')
      .sort((a, b) => a.args.index - b.args.index);
    const lines: string[] = [];
    let alert = false;
    for (const {
      args: { kind, spent, received },
    } of steps) {
      switch (kind) {
        case workflowV2Action.send:
          lines.push(`Sent ${usdc(spent)}`);
          break;
        case workflowV2Action.inactivityPayout:
          lines.push(`Inactivity payout sent · ${usdc(spent)}`);
          break;
        case workflowV2Action.refill:
          lines.push(`Added ${usdc(spent)} to the Vault`);
          break;
        case workflowV2Action.buy:
          lines.push(`Bought ${weth(received)} for ${usdc(spent)}`);
          break;
        case workflowV2Action.sell:
          lines.push(`Sold ${weth(spent)} for ${usdc(received)}`);
          break;
        case workflowV2Action.alert:
          if (!alert) lines.push(await this.observedValue(chain, row, observation?.args.value));
          alert = true;
          break;
      }
    }
    return { alert, lines };
  }

  private async observedValue(chain: FundsChainId, row: Candidate, observed: bigint | undefined) {
    if (observed === undefined) return 'The alert condition was met.';
    const client = clientFor(this.clients, chain);
    const blockNumber = BigInt(row.block_number);
    const program = decodeWorkflowV2(
      await client.readContract({
        address: row.vault,
        abi: workflowVaultV2Abi,
        functionName: 'programs',
        args: [row.program_hash],
        blockNumber,
      }),
    );
    if (program.trigger === workflowV2Trigger.price)
      return `Price observed · ${formatUnits(observed, 18)} USDC per WETH`;
    if (
      program.trigger !== workflowV2Trigger.transfer &&
      program.trigger !== workflowV2Trigger.payment
    )
      return 'The alert condition was met.';
    // Observation can contain a settlement price when a transfer workflow also checks a price.
    // Recover the amount from the exact origin Transfer log in that case and for all payment alerts.
    if (!isFundsChain(row.origin_chain)) return 'The alert condition was met.';
    const originClient = clientFor(this.clients, row.origin_chain);
    const origin = await originClient.getTransactionReceipt({ hash: row.origin_transaction });
    const transfer = parseEventLogs({
      abi: erc20Abi,
      eventName: 'Transfer',
      logs: origin.logs.filter((log) => String(log.logIndex) === row.origin_log_index),
    })[0];
    if (!transfer) return 'The alert condition was met.';
    const { value } = transfer.args;
    if (program.trigger === workflowV2Trigger.payment) return `Payment observed · ${usdc(value)}`;
    const token = program.source.toLowerCase();
    if (transfer.address.toLowerCase() !== token) return 'The alert condition was met.';
    const originChain = getChain(row.origin_chain);
    if (token === originChain.usdc.toLowerCase()) return `Transfer observed · ${usdc(value)}`;
    if (token === originChain.weth.toLowerCase()) return `Transfer observed · ${weth(value)}`;
    const call = { address: program.source, abi: erc20Abi } as const;
    const [decimals, symbol] = await Promise.allSettled([
      originClient.readContract({ ...call, functionName: 'decimals' }),
      originClient.readContract({ ...call, functionName: 'symbol' }),
    ]);
    const unit =
      symbol.status === 'fulfilled' && /^[a-zA-Z0-9_-]{1,12}$/.test(symbol.value)
        ? symbol.value
        : 'tokens';
    const amount =
      decimals.status === 'fulfilled'
        ? `${formatUnits(value, decimals.value)} ${unit}`
        : `${value} token base units`;
    return `Transfer observed · ${amount} (${token})`;
  }
}
