import {
  actions,
  checks,
  decodeWorkflowV2,
  executionCreditAbi,
  getChain,
  LASNA_CHAIN_ID,
  toDraft,
  triggers,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowIdSchema,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  workflowV2Unit,
  type Address,
  type AssistantReference,
  type DraftPath,
  type DraftStep,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { erc20Abi, formatUnits, zeroAddress, type Hex } from 'viem';

import type { ChainClients } from '../chain/clients.js';
import type { WorkflowV2Deployment } from '../workflows/indexerV2.js';
import { workflowV2FailureReason } from '../workflows/failureReasons.js';

const accountReference: AssistantReference = {
  kind: 'account',
  id: 'account',
  label: 'Open Account & Vault',
  href: '/account',
};
const activityReference: AssistantReference = {
  kind: 'activity',
  id: 'activity',
  label: 'Open Activity',
  href: '/activity',
};

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
      properties: { workflowId: workflowIdArgument },
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
      'Read one indexed run with its status, path, reason, and origin, Lasna, and settlement transactions. Use it when the question names a run id.',
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
const workflowArguments = z.object({ workflowId: workflowIdSchema }).strict();
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
  readonly title: string;
  readonly status: 'active' | 'ready to activate' | 'paused' | 'completed';
  readonly active: boolean;
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
  private readonly deploymentId: string;
  private readonly workflows = new Map<string, Promise<WorkflowSnapshot>>();
  private addressesCache?: Promise<{ agent: Address; vault: Address }>;

  constructor(
    private readonly db: SupabaseClient,
    private readonly clients: ChainClients,
    private readonly deployment: WorkflowV2Deployment,
    private readonly owner: Address,
  ) {
    this.deploymentId = deployment.lasna.factory.toLowerCase();
  }

  async execute(name: string, input: unknown): Promise<AssistantToolResult> {
    switch (name) {
      case 'get_account_overview':
        return this.accountOverview();
      case 'list_workflows':
        return this.listWorkflows();
      case 'get_workflow': {
        const { workflowId } = workflowArguments.parse(input);
        const workflow = await this.workflow(workflowId);
        return this.result({ workflow }, workflow.title, [
          {
            kind: 'workflow',
            id: workflow.id,
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
    this.addressesCache ??= Promise.all([
      this.clients.lasna.readContract({
        address: this.deployment.lasna.factory,
        abi: workflowAgentFactoryV2Abi,
        functionName: 'agentOf',
        args: [this.owner],
      }),
      this.clients.unichain.readContract({
        address: this.deployment.unichain.factory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'vaultOf',
        args: [this.owner],
      }),
    ]).then(([agent, vault]) => ({ agent, vault }));
    return this.addressesCache;
  }

  private async accountOverview(): Promise<AssistantToolResult> {
    const { agent, vault } = await this.addresses();
    if (agent === zeroAddress && vault === zeroAddress) {
      return this.result(
        {
          owner: this.owner,
          account: null,
          message:
            'This wallet has not created its Agent or Vault yet. Account setup is the first step.',
        },
        'No account yet',
        [accountReference],
      );
    }

    const system = getChain(LASNA_CHAIN_ID).systemContract;
    const { usdc, weth } = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
    const proxy = await readOrNull(() =>
      this.clients.unichain.readContract({
        address: this.deployment.unichain.factory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'callbackProxy',
      }),
    );
    const tokenBalance = (token: Address, account: Address) =>
      account === zeroAddress
        ? Promise.resolve(null)
        : this.clients.unichain.readContract({
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
      walletReact,
      watching,
      execution,
    ] = await Promise.all([
      readOrNull(() => tokenBalance(usdc, vault)),
      readOrNull(() => tokenBalance(weth, vault)),
      readOrNull(() => tokenBalance(usdc, this.owner)),
      readOrNull(() => tokenBalance(weth, this.owner)),
      readOrNull(() =>
        vault === zeroAddress || usdc === zeroAddress
          ? Promise.resolve(null)
          : this.clients.unichain.readContract({
              address: usdc,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [this.owner, vault],
            }),
      ),
      readOrNull(() =>
        vault === zeroAddress
          ? Promise.resolve(null)
          : this.clients.unichain.getBalance({ address: vault }),
      ),
      readOrNull(() => this.clients.unichain.getBalance({ address: this.owner })),
      readOrNull(() => this.clients.lasna.getBalance({ address: this.owner })),
      readOrNull(() =>
        agent === zeroAddress
          ? Promise.resolve(null)
          : this.clients.lasna.readContract({
              address: system,
              abi: executionCreditAbi,
              functionName: 'reserves',
              args: [agent],
            }),
      ),
      readOrNull(() =>
        vault === zeroAddress || !proxy
          ? Promise.resolve(null)
          : this.clients.unichain.readContract({
              address: proxy,
              abi: executionCreditAbi,
              functionName: 'reserves',
              args: [vault],
            }),
      ),
    ]);

    const data = {
      owner: this.owner,
      agent,
      vault,
      networks: {
        automation: {
          name: 'Reactive Lasna',
          watchingCreditReact: amount(watching, 18),
          walletReact: amount(walletReact, 18),
        },
        funds: {
          name: 'Unichain Sepolia',
          executionCreditEth: amount(execution, 18),
          walletEth: amount(walletEth, 18),
          vaultEth: amount(vaultEth, 18),
        },
      },
      balances: {
        vaultUsdc: amount(vaultUsdc, 6),
        vaultWeth: amount(vaultWeth, 18),
        walletUsdc: amount(walletUsdc, 6),
        walletWeth: amount(walletWeth, 18),
        refillAllowanceUsdc: amount(refillAllowance, 6),
      },
      note: 'A null value means the balance is unavailable because the contract does not exist yet or the read failed. Do not report it as zero.',
    };
    return this.result(data, 'Account balances', [accountReference]);
  }

  private async listWorkflows(): Promise<AssistantToolResult> {
    const { agent, vault } = await this.addresses();
    if (agent === zeroAddress || vault === zeroAddress) {
      return this.result(
        { workflows: [], message: 'This wallet has no workflow account yet.' },
        'No workflows',
        [accountReference],
      );
    }
    const ids = await this.clients.unichain.readContract({
      address: vault,
      abi: workflowVaultV2Abi,
      functionName: 'workflowIds',
    });
    const selected = ids.slice().reverse().slice(0, 6);
    const workflows = await Promise.all(
      selected.map(async (id) => {
        try {
          return await this.workflow(id);
        } catch (error) {
          return {
            id,
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
              id: workflow.id,
              label: `Open ${workflow.title}`,
              href: workflow.href,
            },
          ],
    );
    return this.result(
      {
        count: workflows.length,
        totalSaved: ids.length,
        note:
          ids.length > selected.length
            ? `Only the ${selected.length} newest saved workflows are listed.`
            : undefined,
        workflows,
      },
      `${workflows.length} ${workflows.length === 1 ? 'workflow' : 'workflows'}`,
      references,
    );
  }

  private async workflow(id: Hex): Promise<WorkflowSnapshot> {
    const cached = this.workflows.get(id);
    if (cached) return cached;
    const pending = this.readWorkflow(id);
    this.workflows.set(id, pending);
    return pending;
  }

  private async readWorkflow(id: Hex): Promise<WorkflowSnapshot> {
    const { agent, vault } = await this.addresses();
    if (agent === zeroAddress || vault === zeroAddress)
      throw new Error('This wallet has no workflow account yet.');

    const [entry, auth] = await Promise.all([
      this.clients.lasna.readContract({
        address: agent,
        abi: workflowAgentV2Abi,
        functionName: 'entries',
        args: [id],
      }),
      this.clients.unichain.readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'authorizations',
        args: [id],
      }),
    ]);
    if (entry[1] === 0n && auth[1] === 0n)
      throw new Error('This workflow was not found for the connected wallet.');

    const staged = auth[1] > entry[1] && (auth[3] || entry[1] === 0n);
    const active = entry[4] !== 0 && auth[3] && entry[1] === auth[1] && entry[0] === auth[0];
    const version = staged ? auth[0] : entry[0];
    const lesna = this.clients.lasna;
    const unichain = this.clients.unichain;
    const [title, encoded, memory, budget] = await Promise.all([
      staged
        ? unichain.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'titles',
            args: [id],
          })
        : lesna.readContract({
            address: agent,
            abi: workflowAgentV2Abi,
            functionName: 'titles',
            args: [id],
          }),
      staged
        ? unichain.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'programs',
            args: [version],
          })
        : lesna.readContract({
            address: agent,
            abi: workflowAgentV2Abi,
            functionName: 'programs',
            args: [version],
          }),
      unichain.readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'workflowMemory',
        args: [id],
      }),
      unichain.readContract({
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
        : !active && staged && auth[3]
          ? 'ready to activate'
          : 'paused';
    return {
      id,
      title,
      status,
      active,
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
      href: `/workflows/${id}`,
    };
  }

  private async listRuns(input: z.infer<typeof listRunsArguments>): Promise<AssistantToolResult> {
    const limit = input.limit ?? 5;
    let query = this.db
      .from('workflow_v2_activity')
      .select(
        'id,workflow_id,title,status,reason,path,origin_chain,origin_transaction,lasna_transaction,destination_transaction,lasna_block,expires_at',
      )
      .match({ deployment: this.deploymentId, owner: this.owner });
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
    if (rows.length) references.push(activityReference);
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
        'id,workflow_id,title,status,reason,path,origin_chain,origin_transaction,lasna_transaction,destination_transaction,lasna_block,expires_at',
      )
      .match({ deployment: this.deploymentId, owner: this.owner, id: runId })
      .order('lasna_block', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error('This run could not be read.');
    if (!data) throw new Error('This run was not found for the connected wallet.');
    const run = this.runView(activityRow.parse(data));
    return this.result({ run }, run.status, [
      { kind: 'run', id: run.id, label: `Open ${run.title} run`, href: run.href },
      activityReference,
    ]);
  }

  private runView(row: ActivityRow) {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      title: row.title,
      status: row.status,
      path: row.path === null ? null : row.path + 1,
      reason: row.reason ? workflowV2FailureReason(row.reason).message : null,
      lasnaBlock: row.lasna_block,
      expiresAt: row.expires_at,
      transactions: {
        origin: row.origin_transaction,
        originChain: row.origin_chain,
        lasna: row.lasna_transaction,
        destination: row.destination_transaction,
      },
      href: `/runs/${row.id}`,
    };
  }

  private async searchMarketplace(
    input: z.infer<typeof marketplaceArguments>,
  ): Promise<AssistantToolResult> {
    const limit = input.limit ?? 4;
    let query = this.db
      .from('workflow_v2_market_listings')
      .select('id,title,description,owner,workflow_id,block_number')
      .match({ deployment: this.deploymentId, visible: true });
    const search = input.query?.trim().replace(/[%_\\*]/g, (character) => `\\${character}`);
    if (search) query = query.ilike('title', `%${search}%`);
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
        href: `/marketplace/${row.id}`,
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
        [accountReference],
      );
    const [account, preferences] = await Promise.all([
      this.db
        .from('telegram_accounts')
        .select('chat_id,profile,blocked,enabled,default_mode')
        .eq('agent', agent)
        .maybeSingle(),
      this.db
        .from('telegram_workflow_preferences')
        .select('workflow_id,preference')
        .eq('agent', agent),
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
        setupHref: '/workflows',
      },
      connection === 'connected' ? 'Telegram connected' : 'Telegram not connected',
      [
        {
          kind: 'workflow',
          id: 'notifications',
          label: 'Open a workflow to manage alerts',
          href: '/workflows',
        },
      ],
    );
  }
}
