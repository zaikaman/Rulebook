import {
  actions,
  automationChainFor,
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  checks,
  decodeWorkflowV2,
  executionCreditAbi,
  fundsChainIdSchema,
  fundsChainsFor,
  getChain,
  isAutomationChain,
  isFundsChain,
  toDraft,
  triggers,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowDeploymentKey,
  workflowHealthKey,
  workflowIdSchema,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  workflowV2Unit,
  type Address,
  type AssistantReference,
  type AutomationChainId,
  type DraftPath,
  type DraftStep,
  type FundsChainId,
  type NetworkMode,
  type WorkflowV2Deployment,
  type WorkflowV2MainnetDeployment,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { erc20Abi, formatUnits, zeroAddress, type Hex } from 'viem';

import { clientFor, type ChainClients } from '../chain/clients.js';
import { workflowV2FailureReason } from '../workflows/failureReasons.js';

export interface AssistantToolDefinition {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface AssistantToolResult {
  readonly content: string;
  /** Short label for the UI trace, for example "3 workflows". */
  readonly detail: string;
  readonly references: readonly AssistantReference[];
}

const noArguments = { type: 'object', properties: {}, additionalProperties: false } as const;
const workflowIdArgument = {
  type: 'string',
  pattern: '^0x[0-9a-fA-F]{64}$',
  description: 'The 32-byte workflow id, exactly as returned by list_workflows.',
} as const;

export const assistantToolDefinitions: readonly AssistantToolDefinition[] = [
  {
    name: 'get_account_overview',
    label: 'Reading your balances and credits',
    description:
      'Read the connected wallet’s Agent and Vault addresses, Vault token balances, wallet balances, watching credit, execution credit, and the USDC refill allowance. Use it for questions about funds, credit, addresses, or setup state.',
    parameters: noArguments,
  },
  {
    name: 'list_workflows',
    label: 'Reading your workflows',
    description:
      'List the connected wallet’s saved workflows with their current status, trigger, per-run caps, weekly budget, and readable paths. Use it for “my workflows”, “what needs attention”, or any question that names a workflow you have not resolved yet.',
    parameters: noArguments,
  },
  {
    name: 'get_workflow',
    label: 'Reading this workflow',
    description:
      'Read one workflow in full, including its trigger, checks, actions, per-run caps, weekly budget, expiry, and status. Call it when the question is about a specific workflow id.',
    parameters: {
      type: 'object',
      properties: {
        workflowId: workflowIdArgument,
        chain: {
          type: 'integer',
          description:
            'Optional settlement chain ID when the same workflowId exists on multiple chains.',
        },
      },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_runs',
    label: 'Reading your run history',
    description:
      'Read the newest indexed runs for the connected wallet, optionally for one workflow or one status. Use it for “last run”, “did it work”, “what failed”, or pending questions.',
    parameters: {
      type: 'object',
      properties: {
        workflowId: workflowIdArgument,
        status: {
          type: 'string',
          enum: ['all', 'confirmed', 'skipped', 'expired', 'failed', 'pending', 'in grace period'],
          description: 'Filter by run outcome. Defaults to all.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum runs to return.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_run',
    label: 'Reading this run',
    description:
      'Read one indexed run with its status, path, reason, and origin, automation, and settlement transactions. Use it when the question names a run id.',
    parameters: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          pattern: '^0x[0-9a-fA-F]{64}$',
          description: 'The run id, as returned by list_runs.',
        },
      },
      required: ['runId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_marketplace',
    label: 'Searching the Marketplace',
    description:
      'Search public Marketplace listings by title. Use it when the user wants ideas or wants to know what other wallets have published. Marketplace listings are public, not account data.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 80, description: 'Words to match in the title.' },
        limit: { type: 'integer', minimum: 1, maximum: 6, description: 'Maximum listings.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_notifications',
    label: 'Reading your notification settings',
    description:
      'Read Telegram notification status for the connected wallet’s Agent, including whether it is connected, the default delivery mode, and per-workflow preferences. Use it for alert or notification questions.',
    parameters: noArguments,
  },
];

const listRunsArguments = z
  .object({
    workflowId: workflowIdSchema.optional(),
    status: z
      .enum(['all', 'confirmed', 'skipped', 'expired', 'failed', 'pending', 'in grace period'])
      .optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();
const workflowArguments = z
  .object({ workflowId: workflowIdSchema, chain: fundsChainIdSchema.optional() })
  .strict();
const runArguments = z.object({ runId: workflowIdSchema }).strict();
const marketplaceArguments = z
  .object({
    query: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(6).optional(),
  })
  .strict();

const activityRow = z.object({
  id: workflowIdSchema,
  workflow_id: workflowIdSchema,
  chain: z.number().int().default(UNICHAIN_SEPOLIA_CHAIN_ID),
  title: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  path: z.number().int().nullable(),
  origin_chain: z.number().int(),
  origin_transaction: workflowIdSchema,
  lasna_transaction: workflowIdSchema,
  destination_transaction: workflowIdSchema.nullable(),
  lasna_block: z.coerce.number().int().nonnegative(),
  expires_at: z.coerce.number().int().nonnegative(),
});
const marketplaceRow = z.object({
  id: z.string().regex(/^[1-9]\d{0,77}$/),
  title: z.string(),
  description: z.string(),
  owner: z.string(),
  workflow_id: workflowIdSchema,
  block_number: z.coerce.number().int().nonnegative(),
});
const telegramAccountRow = z.object({
  chat_id: z.string().nullable(),
  profile: z.string().nullable(),
  blocked: z.boolean(),
  enabled: z.boolean(),
  default_mode: z.enum(['all', 'selected']),
});
const telegramPreferenceRow = z.object({
  workflow_id: z.string(),
  preference: z.enum(['inherit', 'send', 'mute']),
});

type ActivityRow = z.infer<typeof activityRow>;

interface WorkflowSnapshot {
  readonly id: Hex;
  readonly chain: FundsChainId;
  readonly chainName: string;
  readonly originChain: FundsChainId;
  readonly originChainName: string;
  readonly crossChain: boolean;
  readonly title: string;
  readonly status: 'active' | 'still watching' | 'ready to activate' | 'paused' | 'completed';
  readonly active: boolean;
  readonly partiallyPaused: boolean;
  readonly readyToActivate: boolean;
  readonly closed: boolean;
  readonly trigger: string;
  readonly scheduleSeconds: number | null;
  readonly expiresAt: number | null;
  readonly once: boolean;
  readonly caps: {
    readonly usdcPerRun: string;
    readonly wethPerRun: string;
    readonly slippagePercent: string;
  };
  readonly weeklyBudget: {
    readonly usdcLimit: string;
    readonly wethLimit: string;
    readonly usdcRemaining: string;
    readonly wethRemaining: string;
    readonly resetsAt: number;
  };
  readonly paths: readonly { readonly condition: string; readonly actions: string }[];
  readonly href: string;
}

function conditionLabel(path: Extract<DraftPath, { check: number }>) {
  const check = checks[path.check];
  const parts = [check.name, path.value, path.upper ? `to ${path.upper}` : ''].filter(Boolean);
  return parts.join(' ');
}

function stepLabel(step: DraftStep) {
  const action = actions[step.kind];
  const unit =
    step.unit === workflowV2Unit.percent ? '% of the incoming payment' : (action.asset ?? '');
  return [
    action.name,
    step.amount ? `${step.amount} ${unit}` : '',
    step.recipient ? `to ${step.recipient}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function readablePaths(root: DraftPath) {
  const rows: { condition: string; actions: string }[] = [];
  function visit(path: DraftPath, trail: string[]) {
    if ('steps' in path) {
      rows.push({
        condition: trail.length ? trail.join(' and ') : 'Always',
        actions: path.steps.length ? path.steps.map(stepLabel).join(', then ') : 'Skip the run',
      });
      return;
    }
    const label = conditionLabel(path);
    visit(path.yes, [...trail, label]);
    visit(path.no, [...trail, `Otherwise (${label} is false)`]);
  }
  visit(root, []);
  return rows;
}

function amount(value: bigint | null, decimals: number) {
  return value === null ? null : formatUnits(value, decimals);
}

async function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/**
 * Every tool reads from the session owner, never from model-supplied input. The model can choose
 * which workflow or run to inspect, but it cannot widen the wallet scope.
 */
export class AssistantToolExecutor {
  private readonly mode: NetworkMode;
  private readonly automationChain: AutomationChainId;
  private readonly automationFactory: Address;
  private readonly automationName: string;
  private readonly fundsChainIds: readonly FundsChainId[];
  private readonly deploymentId: string;
  private readonly workflows = new Map<string, Promise<WorkflowSnapshot>>();
  private addressesCache?: Promise<{
    agent: Address;
    vaults: Partial<Record<FundsChainId, Address>>;
    failedChains: FundsChainId[];
  }>;

  constructor(
    private readonly db: SupabaseClient,
    private readonly clients: ChainClients,
    private readonly deployment: WorkflowV2Deployment | WorkflowV2MainnetDeployment,
    private readonly owner: Address,
  ) {
    if ('reactive' in deployment) {
      this.mode = 'mainnet';
      this.automationChain = automationChainFor('mainnet');
      this.automationFactory = deployment.reactive.factory;
    } else {
      this.mode = 'testnet';
      this.automationChain = automationChainFor('testnet');
      this.automationFactory = deployment.lasna.factory;
    }
    this.automationName = getChain(this.automationChain).name;
    this.fundsChainIds = fundsChainsFor(this.mode);
    this.deploymentId = workflowDeploymentKey(this.automationChain, this.automationFactory);
  }

  private withNetwork(href: string): string {
    if (this.mode !== 'mainnet') return href;
    return `${href}${href.includes('?') ? '&' : '?'}network=mainnet`;
  }

  private accountReference(): AssistantReference {
    return {
      kind: 'account',
      id: 'account',
      label: 'Open Account & Vault',
      href: this.withNetwork('/account'),
    };
  }

  private activityReference(): AssistantReference {
    return {
      kind: 'activity',
      id: 'activity',
      label: 'Open Activity',
      href: this.withNetwork('/activity'),
    };
  }

  private automationClient() {
    return clientFor(this.clients, this.automationChain);
  }

  private configuredFundsChains(): readonly FundsChainId[] {
    return this.fundsChainIds.filter((chain) => {
      if (chain === BASE_SEPOLIA_CHAIN_ID) {
        return Boolean(this.deployment.base && this.clients.base);
      }
      if (chain === BASE_MAINNET_CHAIN_ID) {
        return Boolean(this.deployment.base && this.clients.baseMainnet);
      }
      return true;
    });
  }

  private factoryFor(chain: FundsChainId): Address | undefined {
    return chain === BASE_SEPOLIA_CHAIN_ID || chain === BASE_MAINNET_CHAIN_ID
      ? this.deployment.base?.factory
      : this.deployment.unichain.factory;
  }

  async execute(name: string, input: unknown): Promise<AssistantToolResult> {
    switch (name) {
      case 'get_account_overview':
        return this.accountOverview();
      case 'list_workflows':
        return this.listWorkflows();
      case 'get_workflow': {
        const { workflowId, chain } = workflowArguments.parse(input);
        const workflow = await this.workflow(workflowId, chain);
        return this.result({ workflow }, workflow.title, [
          {
            kind: 'workflow',
            id: workflowHealthKey(workflow.chain, workflow.id),
            label: `Open ${workflow.title}`,
            href: workflow.href,
          },
        ]);
      }
      case 'list_runs':
        return this.listRuns(listRunsArguments.parse(input));
      case 'get_run': {
        const { runId } = runArguments.parse(input);
        return this.getRun(runId);
      }
      case 'search_marketplace':
        return this.searchMarketplace(marketplaceArguments.parse(input));
      case 'get_notifications':
        return this.notifications();
      default:
        throw new Error('That read is not available.');
    }
  }

  private result(
    data: unknown,
    detail: string,
    references: readonly AssistantReference[] = [],
  ): AssistantToolResult {
    const content = JSON.stringify(data);
    if (content.length > 12_000)
      return {
        content: JSON.stringify({
          notice: 'This result is too large to summarize safely. Ask for a smaller slice.',
        }),
        detail: 'Result too large',
        references,
      };
    return { content, detail, references };
  }

  private addresses() {
    if (!this.addressesCache) {
      const pending = (async () => {
        const chains = this.configuredFundsChains();
        const [agent, vaultResults] = await Promise.all([
          this.automationClient().readContract({
            address: this.automationFactory,
            abi: workflowAgentFactoryV2Abi,
            functionName: 'agentOf',
            args: [this.owner],
          }),
          Promise.allSettled(
            chains.map((chain) => {
              const factory = this.factoryFor(chain);
              if (!factory) return Promise.resolve(zeroAddress);
              return clientFor(this.clients, chain).readContract({
                address: factory,
                abi: workflowVaultFactoryV2Abi,
                functionName: 'vaultOf',
                args: [this.owner],
              });
            }),
          ),
        ]);
        const vaults: Partial<Record<FundsChainId, Address>> = {};
        const failedChains: FundsChainId[] = [];
        chains.forEach((chain, index) => {
          const outcome = vaultResults[index];
          if (outcome?.status === 'fulfilled') {
            vaults[chain] = outcome.value;
          } else {
            failedChains.push(chain);
          }
        });
        return { agent, vaults, failedChains };
      })().catch((error) => {
        if (this.addressesCache === pending) this.addressesCache = undefined;
        throw error;
      });
      this.addressesCache = pending;
    }
    return this.addressesCache;
  }

  private async fundsOverview(chain: FundsChainId, vault: Address) {
    const client = clientFor(this.clients, chain);
    const factory = this.factoryFor(chain);
    const chainMeta = getChain(chain);
    const { usdc, weth } = chainMeta;
    const proxy = factory
      ? await readOrNull(() =>
          client.readContract({
            address: factory,
            abi: workflowVaultFactoryV2Abi,
            functionName: 'callbackProxy',
          }),
        )
      : null;
    const tokenBalance = (token: Address, account: Address) =>
      account === zeroAddress
        ? Promise.resolve(null)
        : client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [account],
          });
    const [
      vaultUsdc,
      vaultWeth,
      walletUsdc,
      walletWeth,
      refillAllowance,
      vaultEth,
      walletEth,
      execution,
      executionDebt,
    ] = await Promise.all([
      readOrNull(() => tokenBalance(usdc, vault)),
      readOrNull(() => tokenBalance(weth, vault)),
      readOrNull(() => tokenBalance(usdc, this.owner)),
      readOrNull(() => tokenBalance(weth, this.owner)),
      readOrNull(() =>
        vault === zeroAddress || usdc === zeroAddress
          ? Promise.resolve(null)
          : client.readContract({
              address: usdc,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [this.owner, vault],
            }),
      ),
      readOrNull(() =>
        vault === zeroAddress ? Promise.resolve(null) : client.getBalance({ address: vault }),
      ),
      readOrNull(() => client.getBalance({ address: this.owner })),
      readOrNull(() =>
        vault === zeroAddress || !proxy
          ? Promise.resolve(null)
          : client.readContract({
              address: proxy,
              abi: executionCreditAbi,
              functionName: 'reserves',
              args: [vault],
            }),
      ),
      readOrNull(() =>
        vault === zeroAddress || !proxy
          ? Promise.resolve(null)
          : client.readContract({
              address: proxy,
              abi: executionCreditAbi,
              functionName: 'debt',
              args: [vault],
            }),
      ),
    ]);
    return {
      chain,
      name: chainMeta.name,
      vault,
      executionCreditEth: amount(execution, 18),
      executionDebtEth: amount(executionDebt, 18),
      walletEth: amount(walletEth, 18),
      vaultEth: amount(vaultEth, 18),
      vaultUsdc: amount(vaultUsdc, 6),
      vaultWeth: amount(vaultWeth, 18),
      walletUsdc: amount(walletUsdc, 6),
      walletWeth: amount(walletWeth, 18),
      refillAllowanceUsdc: amount(refillAllowance, 6),
    };
  }

  private async accountOverview(): Promise<AssistantToolResult> {
    const { agent, vaults, failedChains } = await this.addresses();
    const chains = this.configuredFundsChains();
    const anyVault = chains.some((chain) => vaults[chain] && vaults[chain] !== zeroAddress);
    if (agent === zeroAddress && !anyVault && failedChains.length === 0) {
      return this.result(
        {
          owner: this.owner,
          account: null,
          message:
            'This wallet has not created its Agent or Vault yet. Account setup is the first step.',
        },
        'No account yet',
        [this.accountReference()],
      );
    }

    const system = getChain(this.automationChain).systemContract;
    const autoClient = this.automationClient();
    const [walletReact, watching, watchingDebt, perChain] = await Promise.all([
      readOrNull(() => autoClient.getBalance({ address: this.owner })),
      readOrNull(() =>
        agent === zeroAddress
          ? Promise.resolve(null)
          : autoClient.readContract({
              address: system,
              abi: executionCreditAbi,
              functionName: 'reserves',
              args: [agent],
            }),
      ),
      readOrNull(() =>
        agent === zeroAddress
          ? Promise.resolve(null)
          : autoClient.readContract({
              address: system,
              abi: executionCreditAbi,
              functionName: 'debt',
              args: [agent],
            }),
      ),
      Promise.all(chains.map((chain) => this.fundsOverview(chain, vaults[chain] ?? zeroAddress))),
    ]);
    const primary = perChain.find((entry) => entry.vault !== zeroAddress) ?? perChain[0]!;
    const vaultsByChain = Object.fromEntries(perChain.map((entry) => [entry.chain, entry]));

    const data = {
      network: this.mode,
      owner: this.owner,
      agent,
      vault: primary.vault,
      vaults: vaultsByChain,
      networks: {
        automation: {
          name: this.automationName,
          watchingCreditReact: amount(watching, 18),
          watchingDebtReact: amount(watchingDebt, 18),
          walletReact: amount(walletReact, 18),
        },
        funds: {
          name: primary.name,
          executionCreditEth: primary.executionCreditEth,
          executionDebtEth: primary.executionDebtEth,
          walletEth: primary.walletEth,
          vaultEth: primary.vaultEth,
        },
        allFundsChains: perChain,
      },
      balances: {
        vaultUsdc: primary.vaultUsdc,
        vaultWeth: primary.vaultWeth,
        walletUsdc: primary.walletUsdc,
        walletWeth: primary.walletWeth,
        refillAllowanceUsdc: primary.refillAllowanceUsdc,
      },
      ...(failedChains.length > 0
        ? { unavailableChains: failedChains.map((chain) => getChain(chain).name) }
        : {}),
      note: 'A null value means the balance is unavailable because the contract does not exist yet or the read failed. Do not report it as zero.',
    };
    return this.result(data, 'Account balances', [this.accountReference()]);
  }

  private async listWorkflows(): Promise<AssistantToolResult> {
    const { agent, vaults, failedChains } = await this.addresses();
    const deployedChains = this.configuredFundsChains().filter(
      (chain) => vaults[chain] && vaults[chain] !== zeroAddress,
    );
    if (agent === zeroAddress || (deployedChains.length === 0 && failedChains.length === 0)) {
      return this.result(
        { workflows: [], message: 'This wallet has no workflow account yet.' },
        'No workflows',
        [this.accountReference()],
      );
    }
    const chainErrors = new Set<FundsChainId>(failedChains);
    const idResults = await Promise.allSettled(
      deployedChains.map(async (chain) => ({
        chain,
        ids: await clientFor(this.clients, chain).readContract({
          address: vaults[chain]!,
          abi: workflowVaultV2Abi,
          functionName: 'workflowIds',
        }),
      })),
    );
    const perChainIds: Array<{ chain: FundsChainId; ids: readonly Hex[] }> = [];
    deployedChains.forEach((chain, index) => {
      const outcome = idResults[index];
      if (outcome?.status === 'fulfilled') perChainIds.push(outcome.value);
      else chainErrors.add(chain);
    });
    const reversedByChain = perChainIds.map(({ chain, ids }) => ({
      chain,
      ids: ids.slice().reverse(),
    }));
    const interleaved: Array<{ id: Hex; chain: FundsChainId }> = [];
    const maxLen = Math.max(0, ...reversedByChain.map((entry) => entry.ids.length));
    for (let idx = 0; idx < maxLen; idx += 1) {
      for (const entry of reversedByChain) {
        const id = entry.ids[idx];
        if (id) interleaved.push({ id, chain: entry.chain });
      }
    }
    const seen = new Set<string>();
    const uniqueReverse = interleaved.filter(({ id, chain }) => {
      const key = workflowHealthKey(chain, id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const chainCounts = new Map<string, number>();
    for (const { id } of uniqueReverse) {
      const normalized = id.toLowerCase();
      chainCounts.set(normalized, (chainCounts.get(normalized) ?? 0) + 1);
    }
    const selected = uniqueReverse.slice(0, 6);
    const workflows = await Promise.all(
      selected.map(async ({ id, chain }) => {
        try {
          const snapshot = await this.workflow(id, chain);
          if ((chainCounts.get(id.toLowerCase()) ?? 0) > 1) {
            return {
              ...snapshot,
              href: this.withNetwork(`/workflows/${id}?chain=${chain}`),
            };
          }
          return snapshot;
        } catch (error) {
          return {
            id,
            chain,
            error: error instanceof Error ? error.message : 'This workflow could not be read.',
          };
        }
      }),
    );
    const references = workflows.flatMap((workflow) =>
      'error' in workflow
        ? []
        : [
            {
              kind: 'workflow' as const,
              id: workflowHealthKey(workflow.chain, workflow.id),
              label: `Open ${workflow.title}`,
              href: workflow.href,
            },
          ],
    );
    const unavailableChains = [...chainErrors].map((chain) => getChain(chain).name);
    return this.result(
      {
        count: workflows.length,
        totalSaved: uniqueReverse.length,
        ...(unavailableChains.length > 0 ? { unavailableChains } : {}),
        note:
          uniqueReverse.length > selected.length
            ? `Only the ${selected.length} newest saved workflows are listed.`
            : undefined,
        workflows,
      },
      `${workflows.length} ${workflows.length === 1 ? 'workflow' : 'workflows'}`,
      references,
    );
  }

  private async workflow(id: Hex, hintChain?: FundsChainId): Promise<WorkflowSnapshot> {
    const normalized = id.toLowerCase();
    const key = hintChain ? workflowHealthKey(hintChain, normalized) : normalized;
    const cached = this.workflows.get(key);
    if (cached) return cached;
    const pending = this.readWorkflow(id, hintChain).catch((error) => {
      if (this.workflows.get(key) === pending) this.workflows.delete(key);
      throw error;
    });
    this.workflows.set(key, pending);
    return pending;
  }

  private async readWorkflow(id: Hex, hintChain?: FundsChainId): Promise<WorkflowSnapshot> {
    const { agent, vaults } = await this.addresses();
    const deployedChains = this.configuredFundsChains().filter(
      (chain) => vaults[chain] && vaults[chain] !== zeroAddress,
    );
    if (agent === zeroAddress || deployedChains.length === 0)
      throw new Error('This wallet has no workflow account yet.');

    const autoClient = this.automationClient();
    const entry = await autoClient.readContract({
      address: agent,
      abi: workflowAgentV2Abi,
      functionName: 'entries',
      args: [id],
    });
    const entryChain = isFundsChain(entry[5]) ? entry[5] : undefined;
    let targetChain = hintChain ?? entryChain;
    let auth: readonly [Hex, bigint, bigint, boolean] | undefined;

    if (targetChain && vaults[targetChain] && vaults[targetChain] !== zeroAddress) {
      auth = await clientFor(this.clients, targetChain).readContract({
        address: vaults[targetChain]!,
        abi: workflowVaultV2Abi,
        functionName: 'authorizations',
        args: [id],
      });
    } else {
      for (const candidate of deployedChains) {
        const result = await clientFor(this.clients, candidate).readContract({
          address: vaults[candidate]!,
          abi: workflowVaultV2Abi,
          functionName: 'authorizations',
          args: [id],
        });
        if (result[1] !== 0n || result[3]) {
          targetChain = candidate;
          auth = result;
          break;
        }
      }
    }

    if (!targetChain || !auth) {
      throw new Error('This workflow was not found for the connected wallet.');
    }
    const entryMatchesChain = entry[5] === targetChain;
    if ((!entryMatchesChain || entry[1] === 0n) && auth[1] === 0n) {
      throw new Error('This workflow was not found for the connected wallet.');
    }
    const vault = vaults[targetChain]!;
    const sink = clientFor(this.clients, targetChain);

    const staged = entryMatchesChain
      ? auth[1] > entry[1] && (auth[3] || entry[1] === 0n)
      : auth[1] > 0n;
    const active =
      entryMatchesChain &&
      entry[4] !== 0 &&
      auth[3] &&
      entry[1] === auth[1] &&
      entry[0] === auth[0];
    const partiallyPaused = !active && entryMatchesChain && entry[4] !== 0 && !auth[3];
    const readFromVault = staged || !entryMatchesChain;
    const version = readFromVault ? auth[0] : entry[0];
    const [title, encoded, memory, budget] = await Promise.all([
      readFromVault
        ? sink.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'titles',
            args: [id],
          })
        : autoClient.readContract({
            address: agent,
            abi: workflowAgentV2Abi,
            functionName: 'titles',
            args: [id],
          }),
      readFromVault
        ? sink.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'programs',
            args: [version],
          })
        : autoClient.readContract({
            address: agent,
            abi: workflowAgentV2Abi,
            functionName: 'programs',
            args: [version],
          }),
      sink.readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'workflowMemory',
        args: [id],
      }),
      sink.readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'weeklyBudget',
        args: [id],
      }),
    ]);
    const program = decodeWorkflowV2(encoded);
    const draft = toDraft(program, title);
    const closed = Boolean(memory[7]);
    const status = closed
      ? 'completed'
      : active
        ? 'active'
        : partiallyPaused
          ? 'still watching'
          : !active && staged && auth[3]
            ? 'ready to activate'
            : 'paused';
    const originChain = isFundsChain(program.originChain) ? program.originChain : targetChain;
    return {
      id,
      chain: targetChain,
      chainName: getChain(targetChain).name,
      originChain,
      originChainName: getChain(originChain).name,
      crossChain: originChain !== targetChain,
      title,
      status,
      active,
      partiallyPaused,
      readyToActivate: status === 'ready to activate',
      closed,
      trigger: triggers[draft.trigger],
      scheduleSeconds: draft.interval ? Number(draft.interval) : null,
      expiresAt: draft.expires ? Number(draft.expires) : null,
      once: draft.once,
      caps: {
        usdcPerRun: draft.usdcCap || '0',
        wethPerRun: draft.wethCap || '0',
        slippagePercent: draft.slippage || '0',
      },
      weeklyBudget: {
        usdcLimit: formatUnits(budget[0], 6),
        wethLimit: formatUnits(budget[1], 18),
        usdcRemaining: formatUnits(budget[4], 6),
        wethRemaining: formatUnits(budget[5], 18),
        resetsAt: Number(budget[6]),
      },
      paths: readablePaths(draft.root),
      href:
        hintChain || targetChain !== this.fundsChainIds[0]
          ? this.withNetwork(`/workflows/${id}?chain=${targetChain}`)
          : this.withNetwork(`/workflows/${id}`),
    };
  }

  private async listRuns(input: z.infer<typeof listRunsArguments>): Promise<AssistantToolResult> {
    const limit = input.limit ?? 5;
    let query = this.db
      .from('workflow_v2_activity')
      .select(
        'id,workflow_id,chain,title,status,reason,path,origin_chain,origin_transaction,lasna_transaction,destination_transaction,lasna_block,expires_at',
      )
      .match({ deployment: this.deploymentId, owner: this.owner })
      .in('chain', [...this.fundsChainIds]);
    if (input.workflowId) query = query.eq('workflow_id', input.workflowId);
    if (input.status && input.status !== 'all') query = query.eq('status', input.status);
    const { data, error } = await query
      .order('lasna_block', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw new Error('Run history could not be read.');
    const rows = z
      .array(activityRow)
      .parse(data ?? [])
      .map((row) => this.runView(row));
    const references: AssistantReference[] = rows.length
      ? rows.flatMap((row) => [
          { kind: 'run' as const, id: row.id, label: `Open ${row.title} run`, href: row.href },
        ])
      : [];
    if (rows.length) references.push(this.activityReference());
    return this.result(
      { count: rows.length, filter: input.status ?? 'all', runs: rows },
      `${rows.length} ${rows.length === 1 ? 'run' : 'runs'}`,
      references,
    );
  }

  private async getRun(runId: Hex): Promise<AssistantToolResult> {
    const { data, error } = await this.db
      .from('workflow_v2_activity')
      .select(
        'id,workflow_id,chain,title,status,reason,path,origin_chain,origin_transaction,lasna_transaction,destination_transaction,lasna_block,expires_at',
      )
      .match({ deployment: this.deploymentId, owner: this.owner, id: runId })
      .in('chain', [...this.fundsChainIds])
      .order('lasna_block', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error('This run could not be read.');
    if (!data) throw new Error('This run was not found for the connected wallet.');
    const run = this.runView(activityRow.parse(data));
    return this.result({ run }, run.status, [
      { kind: 'run', id: run.id, label: `Open ${run.title} run`, href: run.href },
      this.activityReference(),
    ]);
  }

  private runView(row: ActivityRow) {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      chain: row.chain,
      chainName: isFundsChain(row.chain) ? getChain(row.chain).name : String(row.chain),
      title: row.title,
      status: row.status,
      path: row.path === null ? null : row.path + 1,
      reason: row.reason ? workflowV2FailureReason(row.reason).message : null,
      lasnaBlock: row.lasna_block,
      expiresAt: row.expires_at,
      transactions: {
        origin: row.origin_transaction,
        originChain: row.origin_chain,
        originChainName:
          isFundsChain(row.origin_chain) || isAutomationChain(row.origin_chain)
            ? getChain(row.origin_chain).name
            : String(row.origin_chain),
        lasna: row.lasna_transaction,
        destination: row.destination_transaction,
      },
      href: this.withNetwork(`/runs/${row.id}`),
    };
  }

  private async searchMarketplace(
    input: z.infer<typeof marketplaceArguments>,
  ): Promise<AssistantToolResult> {
    const limit = input.limit ?? 4;
    let query = this.db
      .from('workflow_v2_market_listings')
      .select('id,title,description,owner,workflow_id,block_number')
      .match({ deployment: this.deploymentId, visible: true })
      .in('chain', [...this.fundsChainIds]);
    const search = input.query?.trim().replace(/[%_\\*"]/g, (character) => `\\${character}`);
    if (search) query = query.or(`title.ilike."%${search}%",description.ilike."%${search}%"`);
    const { data, error } = await query.order('block_number', { ascending: false }).limit(limit);
    if (error) throw new Error('The Marketplace could not be read.');
    const listings = z
      .array(marketplaceRow)
      .parse(data ?? [])
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        publisher: row.owner,
        workflowId: row.workflow_id,
        href: this.withNetwork(`/marketplace/${row.id}`),
      }));
    return this.result(
      { count: listings.length, query: input.query ?? '', listings },
      `${listings.length} ${listings.length === 1 ? 'listing' : 'listings'}`,
      listings.map((listing) => ({
        kind: 'listing' as const,
        id: listing.id,
        label: `Open ${listing.title}`,
        href: listing.href,
      })),
    );
  }

  private async notifications(): Promise<AssistantToolResult> {
    const { agent } = await this.addresses();
    if (agent === zeroAddress)
      return this.result(
        {
          connection: 'not available',
          message: 'This wallet has no Agent yet, so Telegram notifications are not configured.',
        },
        'No notification account',
        [this.accountReference()],
      );
    const normalizedAgent = agent.toLowerCase();
    const [account, preferences] = await Promise.all([
      this.db
        .from('telegram_accounts')
        .select('chat_id,profile,blocked,enabled,default_mode')
        .eq('automation_chain', this.automationChain)
        .eq('agent', normalizedAgent)
        .maybeSingle(),
      this.db
        .from('telegram_workflow_preferences')
        .select('workflow_id,preference')
        .eq('automation_chain', this.automationChain)
        .eq('agent', normalizedAgent),
    ]);
    if (account.error || preferences.error)
      throw new Error('Notification settings could not be read.');
    const settings = account.data ? telegramAccountRow.parse(account.data) : null;
    const connection = !settings
      ? 'not set up'
      : settings.blocked
        ? 'blocked'
        : settings.chat_id
          ? 'connected'
          : 'disconnected';
    const workflowsHref = this.withNetwork('/workflows');
    return this.result(
      {
        connection,
        profile: settings?.profile ?? null,
        enabled: settings?.enabled ?? null,
        defaultMode:
          settings?.default_mode === 'selected' ? 'Only selected workflows' : 'All workflows',
        perWorkflow: z
          .array(telegramPreferenceRow)
          .parse(preferences.data ?? [])
          .map((row) => ({
            workflowId: row.workflow_id,
            preference: row.preference,
          })),
        setupHref: workflowsHref,
      },
      connection === 'connected' ? 'Telegram connected' : 'Telegram not connected',
      [
        {
          kind: 'workflow',
          id: 'notifications',
          label: 'Open a workflow to manage alerts',
          href: workflowsHref,
        },
      ],
    );
  }
}
