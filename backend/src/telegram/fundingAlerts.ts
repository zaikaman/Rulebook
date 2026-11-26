import {
  addressSchema,
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  executionCreditAbi,
  feeCreditWarningThreshold,
  fundsChainIdSchema,
  fundsChainsFor,
  isAutomationChain,
  isFundsChain,
  LASNA_CHAIN_ID,
  networkModeForChain,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentV2Abi,
  workflowDeploymentKey,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  type Address,
  type AutomationChainId,
  type FundsChainId,
} from '@rulebook/shared';
import { formatEther, type Hex } from 'viem';
import { z } from 'zod';

import { clientFor, type ChainClients } from '../chain/clients.js';
import type { TelegramDatabase } from './service.js';

const chainSchema = z.union([
  z.literal(LASNA_CHAIN_ID),
  z.literal(REACTIVE_MAINNET_CHAIN_ID),
  fundsChainIdSchema,
]);
type FundingChain = z.infer<typeof chainSchema>;
const balances = z.enum(['healthy', 'low', 'empty', 'debt']);
const jobs = z.array(
  z.object({ agent: addressSchema, vault: addressSchema.nullable(), lease: z.string().uuid() }),
);
type Job = z.infer<typeof jobs>[number];
export const fundingPreflight = z.object({
  kind: z.literal('funding'),
  chain: chainSchema,
  beneficiary: addressSchema,
  state: balances,
  block: z.string().regex(/^\d+$/),
});

const funding = {
  [LASNA_CHAIN_ID]: {
    label: 'watching credit',
    token: 'test REACT',
    network: 'Reactive Lasna',
    route: 'watching',
    effect: 'Workflows may stop checking for events.',
  },
  [UNICHAIN_SEPOLIA_CHAIN_ID]: {
    label: 'execution credit',
    token: 'test ETH',
    network: 'Unichain Sepolia',
    route: 'execution',
    effect: 'The Vault may be unable to finish workflow runs.',
  },
  [BASE_SEPOLIA_CHAIN_ID]: {
    label: 'execution credit',
    token: 'test ETH',
    network: 'Base Sepolia',
    route: 'execution',
    effect: 'The Vault may be unable to finish workflow runs.',
  },
  [REACTIVE_MAINNET_CHAIN_ID]: {
    label: 'watching credit',
    token: 'REACT',
    network: 'Reactive Mainnet',
    route: 'watching',
    effect: 'Workflows may stop checking for events.',
  },
  [UNICHAIN_MAINNET_CHAIN_ID]: {
    label: 'execution credit',
    token: 'ETH',
    network: 'Unichain',
    route: 'execution',
    effect: 'The Vault may be unable to finish workflow runs.',
  },
  [BASE_MAINNET_CHAIN_ID]: {
    label: 'execution credit',
    token: 'ETH',
    network: 'Base',
    route: 'execution',
    effect: 'The Vault may be unable to finish workflow runs.',
  },
} as const;

type CreditReading = { reserve: bigint; debt: bigint; state: z.infer<typeof balances> };

function fundingState(chain: FundingChain, reserve: bigint, debt: bigint): CreditReading['state'] {
  if (debt > 0n) return 'debt';
  if (reserve === 0n) return 'empty';
  return reserve < feeCreditWarningThreshold(chain) ? 'low' : 'healthy';
}

export class TelegramFundingAlerts {
  private readonly vaultFactories: Partial<Record<FundsChainId, Address>>;
  private readonly deployment: string;

  constructor(
    private readonly db: Pick<TelegramDatabase, 'rpc'>,
    private readonly clients: ChainClients,
    deployment: string,
    vaultFactories: Partial<Record<FundsChainId, Address>> | Address,
    private readonly origin: string,
    private readonly automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    this.deployment = deployment.includes(':')
      ? deployment.toLowerCase()
      : workflowDeploymentKey(automationChain, deployment as Address);
    this.vaultFactories =
      typeof vaultFactories === 'string'
        ? { [UNICHAIN_SEPOLIA_CHAIN_ID]: vaultFactories }
        : vaultFactories;
  }

  handlesChain(chain: number): boolean {
    if (chain === this.automationChain) return true;
    return isFundsChain(chain)
      ? networkModeForChain(chain) === networkModeForChain(this.automationChain) &&
          Boolean(this.vaultFactories[chain])
      : false;
  }

  async process() {
    const modeFundsChains = fundsChainsFor(networkModeForChain(this.automationChain));
    const activeFundsChains = modeFundsChains.filter((chain) =>
      Boolean(this.vaultFactories[chain]),
    );
    const checks = await Promise.allSettled([
      this.checkChain(this.automationChain),
      ...activeFundsChains.map((chain) => this.checkChain(chain)),
    ]);
    if (checks.some(({ status }) => status === 'rejected')) {
      throw new Error('Some Telegram funding checks failed');
    }
  }

  async currentMessage(input: z.infer<typeof fundingPreflight>) {
    const block = await clientFor(this.clients, input.chain).getBlock({ blockTag: 'latest' });
    if (block.number < BigInt(input.block) || Date.now() / 1000 - Number(block.timestamp) > 300)
      throw new Error('Funding RPC is stale');
    const reading = await this.credit(input.chain, input.beneficiary, block.number);
    return reading.state === input.state ? this.message(input.chain, reading) : null;
  }

  private async checkChain(chain: FundingChain) {
    const rows = await this.db.rpc(
      'telegram_claim_funding',
      { p_deployment: this.deployment, p_chain: chain, p_limit: 5 },
      jobs,
    );
    if (!rows.length) return;
    const results = await Promise.allSettled(rows.map((job) => this.checkAccount(chain, job)));
    if (results.some(({ status }) => status === 'rejected')) {
      throw new Error('Some account reserves could not be checked');
    }
  }

  private async checkAccount(chain: FundingChain, job: Job) {
    const client = clientFor(this.clients, chain);
    const block = await client.getBlock({ blockTag: 'latest' });
    if (Date.now() / 1000 - Number(block.timestamp) > 300) throw new Error('Funding RPC is stale');
    const beneficiary = isAutomationChain(chain) ? job.agent : job.vault;
    const active =
      beneficiary && (await this.hasActiveWorkflow(chain, job, block.number, block.timestamp));
    const reading = active ? await this.credit(chain, beneficiary, block.number) : null;
    const message = reading ? this.message(chain, reading) : null;
    await this.db.rpc(
      'telegram_record_funding',
      {
        p_deployment: this.deployment,
        p_agent: job.agent,
        p_chain: chain,
        p_lease: job.lease,
        p_block: block.number.toString(),
        p_state: reading?.state ?? 'inactive',
        p_message: reading?.state === 'healthy' ? null : message,
        p_recovery: reading?.state === 'healthy' ? message : null,
      },
      z.null(),
    );
  }

  private message(chain: FundingChain, { state, reserve, debt }: CreditReading) {
    const info = funding[chain];
    const isMainnet = networkModeForChain(chain) === 'mainnet';
    const link = `${this.origin}/account?credit=${info.route}${
      isMainnet ? `${isFundsChain(chain) ? `&chain=${chain}` : ''}&network=mainnet` : ''
    }`;
    if (state === 'healthy') {
      return [
        `Rulebook · ${info.token} credit restored`,
        `You now have ${formatEther(reserve)} ${info.token} in fee credit on ${info.network}.`,
        link,
      ].join('\n');
    }
    return [
      state === 'debt'
        ? `Rulebook · Unpaid ${info.label} fees`
        : `Rulebook · ${state === 'empty' ? 'Empty' : 'Low'} ${info.label}`,
      state === 'debt'
        ? `You owe ${formatEther(debt)} ${info.token} on ${info.network}.`
        : `You have ${formatEther(reserve)} ${info.token} in fee credit on ${info.network}.`,
      info.effect,
      'Add credit in Account & Vault.',
      link,
    ].join('\n');
  }

  private async hasActiveWorkflow(
    chain: FundingChain,
    { agent, vault }: Job,
    blockNumber: bigint,
    timestamp: bigint,
  ) {
    const source = clientFor(this.clients, this.automationChain);
    const sourceBlock =
      chain === this.automationChain ? blockNumber : await source.getBlockNumber({ cacheTime: 0 });
    const sourceCall = {
      address: agent,
      abi: workflowAgentV2Abi,
      blockNumber: sourceBlock,
    } as const;
    const ids = await source.readContract({ ...sourceCall, functionName: 'workflowIds' });
    if (chain === this.automationChain) {
      return this.anyWorkflow(ids, async (id) => {
        const entry = await source.readContract({
          ...sourceCall,
          functionName: 'entries',
          args: [id],
        });
        // A Lasna subscription can still cost credit while its Vault is paused.
        return entry[4] !== 0;
      });
    }
    if (!vault) return false;
    const sink = clientFor(this.clients, chain);
    return this.anyWorkflow(ids, async (id) => {
      const entry = await source.readContract({
        ...sourceCall,
        functionName: 'entries',
        args: [id],
      });
      if (entry[4] === 0 || entry[5] !== chain || (entry[7] !== 0n && entry[7] <= timestamp))
        return false;
      const auth = await sink.readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'authorizations',
        args: [id],
        blockNumber,
      });
      return auth[3] && auth[1] === entry[1] && auth[0] === entry[0];
    });
  }

  private async anyWorkflow(ids: readonly Hex[], match: (id: Hex) => Promise<boolean>) {
    // Recent workflow IDs are most likely to be active. Keep calls bounded even with old history.
    for (let end = ids.length; end > 0; end -= 8) {
      const matches = await Promise.all(ids.slice(Math.max(0, end - 8), end).map(match));
      if (matches.some(Boolean)) return true;
    }
    return false;
  }

  private async credit(chain: FundingChain, beneficiary: Address, blockNumber: bigint) {
    const client = clientFor(this.clients, chain);
    let address: Address;
    if (isAutomationChain(chain)) {
      address = await client.readContract({
        address: beneficiary,
        abi: workflowAgentV2Abi,
        functionName: 'system',
        blockNumber,
      });
    } else {
      const vaultFactory = this.vaultFactories[chain];
      if (!vaultFactory) throw new Error(`No Vault factory configured for chain ${chain}`);
      address = await client.readContract({
        address: vaultFactory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'callbackProxy',
        blockNumber,
      });
    }
    const call = { address, abi: executionCreditAbi, args: [beneficiary], blockNumber } as const;
    const [reserve, debt] = await Promise.all([
      client.readContract({ ...call, functionName: 'reserves' }),
      client.readContract({ ...call, functionName: 'debt' }),
    ]);
    return { reserve, debt, state: fundingState(chain, reserve, debt) };
  }
}
