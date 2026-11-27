import { formatUnits, toFunctionSelector } from 'viem';
import { z } from 'zod';

import {
  automationChainFor,
  CHAIN_CONFIGS,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
} from './chains.js';
import { fundsChainIdSchema } from './schemas.js';
import { workflowIdSchema, workflowV2RunStatusSchema } from './workflows.js';
import {
  workflowV2Action,
  workflowV2Trigger,
  workflowV2Unit,
  type WorkflowV2Program,
} from './workflowsV2.js';

/**
 * The health contract is deliberately read-only and derived from facts the app already has:
 * the Lasna subscription, the Vault authorization, credit reserves, the weekly budget, and
 * the latest indexed outcome. It never guesses a status from a single signal.
 */
export type WorkflowHealthCode =
  | 'completed'
  | 'expired'
  | 'pause-incomplete'
  | 'paused'
  | 'ready'
  | 'execution-credit'
  | 'watching-credit'
  | 'funding'
  | 'budget'
  | 'grace-period'
  | 'callback-pending'
  | 'run-failed'
  | 'run-expired'
  | 'waiting-payment'
  | 'watching';

export type WorkflowHealthTone = 'active' | 'paused' | 'danger' | 'info';

export type WorkflowHealthFix =
  | 'execution-credit'
  | 'watching-credit'
  | 'weekly-budget'
  | 'account'
  | 'allowance'
  | 'edit'
  | 'pause'
  | 'run'
  | 'activity'
  | 'none';

export type WorkflowHealthRecovery = 'balances' | 'allowance' | 'limits';

export interface WorkflowCreditState {
  readonly reserve: bigint;
  readonly debt: bigint;
  readonly threshold: bigint;
}

export interface WorkflowBudgetState {
  readonly usdcLimit: bigint;
  readonly usdcRemaining: bigint;
  readonly wethLimit: bigint;
  readonly wethRemaining: bigint;
  readonly resetsAt: bigint;
}

/**
 * How far the Vault's spendable principal falls short of one run. A value is positive only when
 * the largest single path needs more of that asset than the Vault holds.
 */
export interface WorkflowFundingShortfall {
  readonly usdc: bigint;
  readonly weth: bigint;
}

/** The Vault's own refusal to move funds it does not hold, recorded as a skipped run. */
export const insufficientVaultBalanceSelector = toFunctionSelector(
  'InsufficientVaultBalance(address,uint256,uint256)',
);

export interface WorkflowHealthRun {
  readonly status: z.infer<typeof workflowV2RunStatusSchema>;
  readonly reason: string | null;
  readonly reasonCode: string | null;
  readonly recovery: WorkflowHealthRecovery | null;
}

export interface WorkflowHealthInput {
  readonly active: boolean;
  readonly readyToActivate: boolean;
  readonly partiallyPaused?: boolean;
  readonly closed: boolean;
  readonly program: Pick<WorkflowV2Program, 'trigger' | 'nodes' | 'expires'> & {
    readonly chain?: number;
  };
  readonly executionCredit: WorkflowCreditState | null;
  readonly watchingCredit: WorkflowCreditState | null;
  readonly budget: WorkflowBudgetState | null;
  /** Null while the Vault balances are unknown, so an unread balance never blocks a status. */
  readonly funding: WorkflowFundingShortfall | null;
  /** On-chain `memory_.eligibleAt` timestamp (0 when cleared by check-in or inactive). */
  readonly eligibleAt?: bigint | number | null;
  readonly lastRun: WorkflowHealthRun | null;
}

export interface WorkflowHealth {
  readonly code: WorkflowHealthCode;
  readonly label: string;
  readonly tone: WorkflowHealthTone;
  readonly summary: string;
  readonly fix: WorkflowHealthFix;
  readonly fixLabel?: string;
  /** True when the owner can act to restore this workflow. */
  readonly attention: boolean;
}

export const workflowHealthRecoverySchema = z.enum(['balances', 'allowance', 'limits']);

export const workflowHealthRunSchema = z.object({
  id: workflowIdSchema,
  status: workflowV2RunStatusSchema,
  reason: z.string().nullable(),
  reasonCode: z.string().nullable(),
  recovery: workflowHealthRecoverySchema.nullable(),
  lasnaTransaction: workflowIdSchema,
  destinationTransaction: workflowIdSchema.nullable(),
  path: z.number().int().nonnegative().nullable(),
  expiresAt: z.number().int().nonnegative().safe(),
});

export const workflowHealthSuccessSchema = z.object({
  id: workflowIdSchema,
  lasnaTransaction: workflowIdSchema,
  destinationTransaction: workflowIdSchema.nullable(),
  path: z.number().int().nonnegative().nullable(),
});

export const workflowHealthEntrySchema = z.object({
  chain: fundsChainIdSchema,
  workflowId: workflowIdSchema,
  lastRun: workflowHealthRunSchema.nullable(),
  lastSuccess: workflowHealthSuccessSchema.nullable(),
  pending: z
    .object({
      id: workflowIdSchema,
      expiresAt: z.number().int().nonnegative().safe(),
    })
    .nullable(),
});

export function workflowHealthKey(chain: number, workflowId: string): string {
  return `${chain}:${workflowId.toLowerCase()}`;
}

export const workflowHealthResponseSchema = z.object({
  workflows: z.array(workflowHealthEntrySchema),
});

export type WorkflowHealthRunSchema = z.infer<typeof workflowHealthRunSchema>;
export type WorkflowHealthSuccess = z.infer<typeof workflowHealthSuccessSchema>;
export type WorkflowHealthEntry = z.infer<typeof workflowHealthEntrySchema>;

function displayAmount(value: bigint, decimals: number, asset: string) {
  const [whole, fraction] = formatUnits(value, decimals).split('.');
  const trimmed = fraction?.slice(0, 4).replace(/0+$/, '');
  return `${whole}${trimmed ? `.${trimmed}` : ''} ${asset}`;
}

function expiryLabel(expires: number) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(expires * 1_000));
}

function resetLabel(resetsAt: bigint) {
  if (resetsAt <= 0n) return '';
  return ` until ${new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(Number(resetsAt) * 1000))}`;
}

interface BudgetBlockResult {
  readonly assets: ('USDC' | 'WETH')[];
  readonly zeroRemaining: boolean;
}

function exhaustedBudget(
  program: Pick<WorkflowV2Program, 'nodes'>,
  budget: WorkflowBudgetState,
): BudgetBlockResult {
  const leaves = program.nodes.filter((node) => node.check === 0 && node.actions.length > 0);
  if (leaves.length === 0) return { assets: [], zeroRemaining: false };

  let anyUsdcBlocked = false;
  let anyWethBlocked = false;
  let allBlocked = true;

  for (const leaf of leaves) {
    let usdcMin = 0n;
    let wethMin = 0n;
    for (const action of leaf.actions) {
      if (action.kind === workflowV2Action.alert) continue;
      if (action.kind === workflowV2Action.sell) {
        wethMin += action.amount;
      } else if (
        action.unit === workflowV2Unit.percent ||
        action.kind === workflowV2Action.refill
      ) {
        // Percent payments and refills can settle with as little as 1 base unit.
        if (usdcMin === 0n) usdcMin = 1n;
      } else {
        usdcMin += action.amount;
      }
    }
    const usdcBlocked = budget.usdcLimit > 0n && usdcMin > budget.usdcRemaining;
    const wethBlocked = budget.wethLimit > 0n && wethMin > budget.wethRemaining;
    if (usdcBlocked) anyUsdcBlocked = true;
    if (wethBlocked) anyWethBlocked = true;
    if (!usdcBlocked && !wethBlocked) {
      allBlocked = false;
    }
  }

  if (!allBlocked) return { assets: [], zeroRemaining: false };
  const assets: ('USDC' | 'WETH')[] = [];
  if (anyUsdcBlocked) assets.push('USDC');
  if (anyWethBlocked) assets.push('WETH');
  const zeroRemaining =
    assets.length > 0 &&
    assets.every((asset) =>
      asset === 'USDC' ? budget.usdcRemaining === 0n : budget.wethRemaining === 0n,
    );
  return { assets, zeroRemaining };
}

function fundingBlock(funding: WorkflowFundingShortfall | null): WorkflowHealth | null {
  if (!funding) return null;
  const short: string[] = [];
  if (funding.usdc > 0n) short.push(displayAmount(funding.usdc, 6, 'USDC'));
  if (funding.weth > 0n) short.push(displayAmount(funding.weth, 18, 'WETH'));
  if (short.length === 0) return null;
  const list = short.length === 2 ? `${short[0]} and ${short[1]}` : short[0]!;
  return {
    code: 'funding',
    label: 'Vault short of funds',
    tone: 'paused',
    summary: `The Vault is short ${list} for one run of this workflow. Add ${list} in Account & Vault so the next trigger can settle; the workflow stays active and a run that cannot be funded is skipped instead of failed.`,
    fix: 'account',
    fixLabel: 'Add funds to the Vault',
    attention: true,
  };
}

function creditBlock(
  credit: WorkflowCreditState | null,
  kind: 'execution' | 'watching',
  chainId: number,
): { label: string; tone: WorkflowHealthTone; summary: string; fix: WorkflowHealthFix } | null {
  if (!credit) return null;
  const execution = kind === 'execution';
  const name = execution ? 'Execution credit' : 'Watching credit';
  const cfg = CHAIN_CONFIGS.get(chainId);
  const asset = execution ? 'ETH' : (cfg?.nativeSymbol ?? 'lREACT');
  const network = cfg?.name ?? (execution ? 'Unichain Sepolia' : 'Reactive Lasna');
  const fix = execution ? 'execution-credit' : 'watching-credit';
  const label = `Blocked by low ${execution ? 'execution' : 'watching'} credit`;
  const reserve = displayAmount(credit.reserve, 18, asset);
  const threshold = displayAmount(credit.threshold, 18, asset);

  if (credit.debt > 0n) {
    return {
      label,
      tone: 'danger',
      fix,
      summary: `${name} owes ${displayAmount(credit.debt, 18, asset)} on ${network}. Add credit to clear the unpaid balance before the next run.`,
    };
  }
  if (credit.reserve < credit.threshold) {
    return {
      label,
      tone: credit.reserve === 0n ? 'danger' : 'paused',
      fix,
      summary:
        credit.reserve === 0n
          ? `${name} is empty on ${network}. Add credit so the workflow can run again.`
          : `${name} is ${reserve}, below the ${threshold} recommended reserve on ${network}. Add credit so the workflow can run again.`,
    };
  }
  return null;
}

/**
 * The status order is the order of what an owner should fix first. A blocked credit lane stops
 * both new triggers and settlement; an exhausted weekly budget skips runs without failing them.
 * A grace period is reported above a pending callback: the Vault already recorded the outcome, so
 * the run has evidence and a payout deadline rather than a missing callback. A pending callback is
 * reported above a stale failure so the newest evidence is what they see.
 */
export function deriveWorkflowHealth(input: WorkflowHealthInput): WorkflowHealth {
  if (input.closed) {
    return {
      code: 'completed',
      label: 'Completed',
      tone: 'info',
      summary: 'This workflow has finished its one-time run. Its history remains available.',
      fix: 'activity',
      fixLabel: 'View activity',
      attention: false,
    };
  }

  const expires = Number(input.program.expires);
  if (expires !== 0 && expires * 1_000 <= Date.now()) {
    return {
      code: 'expired',
      label: 'Expired',
      tone: 'paused',
      summary: `This workflow's signed expiry passed on ${expiryLabel(expires)}, so it cannot run again. Edit the expiry and reactivate it to continue.`,
      fix: 'edit',
      fixLabel: 'Edit expiry',
      attention: true,
    };
  }

  const settlementChainId = input.program.chain ?? UNICHAIN_SEPOLIA_CHAIN_ID;
  const settlementConfig = CHAIN_CONFIGS.get(settlementChainId);
  const settlementName = settlementConfig?.name ?? 'Unichain Sepolia';
  const automationChainId = automationChainFor(settlementConfig?.network ?? 'testnet');
  const automationName = CHAIN_CONFIGS.get(automationChainId)?.name ?? 'Reactive Lasna';
  const isMainnet = automationChainId === REACTIVE_MAINNET_CHAIN_ID;

  if (!input.active) {
    if (input.partiallyPaused) {
      return {
        code: 'pause-incomplete',
        label: isMainnet ? 'Still watching on Reactive Mainnet' : 'Still watching on Lasna',
        tone: 'danger',
        summary: `Vault spending is revoked, but ${automationName} is still watching for triggers. Finish pausing so it stops using watching credit.`,
        fix: 'pause',
        fixLabel: 'Finish pausing',
        attention: true,
      };
    }
    if (input.readyToActivate) {
      return {
        code: 'ready',
        label: 'Ready to activate',
        tone: 'info',
        summary: `The Vault authorization is staged. Finish activation so ${automationName} starts watching for events.`,
        fix: 'edit',
        fixLabel: 'Finish activation',
        attention: true,
      };
    }
    return {
      code: 'paused',
      label: 'Paused',
      tone: 'paused',
      summary:
        'This workflow is not watching for events. Review and activate it when you want it to run again.',
      fix: 'edit',
      fixLabel: 'Review workflow',
      attention: true,
    };
  }

  const execution = creditBlock(input.executionCredit, 'execution', settlementChainId);
  if (execution) {
    return {
      code: 'execution-credit',
      label: execution.label,
      tone: execution.tone,
      summary: execution.summary,
      fix: execution.fix,
      fixLabel: 'Add execution credit',
      attention: true,
    };
  }

  const watching = creditBlock(input.watchingCredit, 'watching', automationChainId);
  if (watching) {
    return {
      code: 'watching-credit',
      label: watching.label,
      tone: watching.tone,
      summary: watching.summary,
      fix: watching.fix,
      fixLabel: 'Add watching credit',
      attention: true,
    };
  }

  const funding = fundingBlock(input.funding);
  if (funding) return funding;

  // A shortfall recorded on chain also counts when the live balances cannot be read yet, and it
  // keeps the skipped run from being reported as a failure.
  if (
    input.funding === null &&
    input.lastRun?.status === 'skipped' &&
    input.lastRun.reasonCode === insufficientVaultBalanceSelector
  ) {
    return {
      code: 'funding',
      label: 'Vault short of funds',
      tone: 'paused',
      summary:
        'The last run was skipped because the Vault did not hold enough of the asset it needed. Nothing was spent and the workflow stays active. Add funds in Account & Vault so the next trigger can settle.',
      fix: 'account',
      fixLabel: 'Add funds to the Vault',
      attention: true,
    };
  }

  if (input.budget) {
    const { assets, zeroRemaining } = exhaustedBudget(input.program, input.budget);
    if (assets.length > 0) {
      const names = assets.length === 2 ? `${assets[0]} and ${assets[1]}` : assets[0]!;
      return {
        code: 'budget',
        label: 'Budget reached',
        tone: 'paused',
        summary: zeroRemaining
          ? `The weekly ${names} budget is used up${resetLabel(input.budget.resetsAt)}. Raise the limit or wait for the reset.`
          : `The remaining weekly ${names} budget is below what one run needs${resetLabel(input.budget.resetsAt)}. Raise the limit or wait for the reset.`,
        fix: 'weekly-budget',
        fixLabel: 'Edit weekly budget',
        attention: true,
      };
    }
  }

  const eligibleAtSec =
    input.eligibleAt !== undefined && input.eligibleAt !== null
      ? Number(input.eligibleAt)
      : undefined;
  const inGrace =
    eligibleAtSec !== undefined ? eligibleAtSec > 0 : input.lastRun?.status === 'in grace period';
  if (inGrace) {
    return {
      code: 'grace-period',
      label: 'Inactivity payout in grace period',
      tone: 'info',
      summary:
        'This run matched an inactivity payout. The Vault holds the payout for 24 hours so you can cancel it by checking in, then releases it on the next run after the grace period ends.',
      fix: 'run',
      fixLabel: 'Open run',
      attention: true,
    };
  }

  if (input.lastRun?.status === 'pending') {
    return {
      code: 'callback-pending',
      label: 'Callback pending',
      tone: 'paused',
      summary: `A run was dispatched and is waiting for settlement on ${settlementName}. Open the run to follow its receipt.`,
      fix: 'run',
      fixLabel: 'Open pending run',
      attention: false,
    };
  }

  if (input.lastRun?.status === 'failed') {
    const recovery = input.lastRun.recovery;
    return {
      code: 'run-failed',
      label: 'Last run failed',
      tone: 'danger',
      summary: `${input.lastRun.reason ?? 'The last run failed before it could settle.'} Open the run to inspect the chain evidence.`,
      fix:
        recovery === 'balances' || recovery === 'allowance'
          ? 'account'
          : recovery === 'limits'
            ? 'edit'
            : 'run',
      fixLabel:
        recovery === 'balances'
          ? 'Open Account & Vault'
          : recovery === 'allowance'
            ? 'Review allowance'
            : recovery === 'limits'
              ? 'Review workflow limits'
              : 'Open failed run',
      attention: true,
    };
  }

  if (input.lastRun?.status === 'expired') {
    return {
      code: 'run-expired',
      label: 'Last run unconfirmed',
      tone: 'paused',
      summary:
        'The last run reached its deadline without a confirmed result. Open the run to check what happened.',
      fix: 'run',
      fixLabel: 'Open run',
      attention: true,
    };
  }

  if (input.program.trigger === workflowV2Trigger.payment) {
    return {
      code: 'waiting-payment',
      label: 'Waiting for a payment',
      tone: 'active',
      summary: input.lastRun
        ? 'This workflow is active and waiting for the next matching USDC payment.'
        : 'This workflow runs when the Vault receives a matching USDC payment. No payment has triggered it yet.',
      fix: 'activity',
      fixLabel: 'View activity',
      attention: false,
    };
  }

  const trigger =
    input.program.trigger === workflowV2Trigger.schedule
      ? 'the next scheduled check'
      : input.program.trigger === workflowV2Trigger.price
        ? 'the next price update'
        : input.program.trigger === workflowV2Trigger.transfer
          ? 'the next matching transfer'
          : 'the next trigger';
  return {
    code: 'watching',
    label: 'Watching for the next trigger',
    tone: 'active',
    summary: `This workflow is active and waiting for ${trigger}.`,
    fix: 'activity',
    fixLabel: 'View activity',
    attention: false,
  };
}
