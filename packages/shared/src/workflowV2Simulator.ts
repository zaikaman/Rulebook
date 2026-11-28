import { formatUnits, parseUnits, zeroAddress, type Address } from 'viem';

import {
  actions,
  actionDecimals,
  checkDecimals,
  checks,
  checkThresholdRules,
  checkUpperRules,
  readWeeklyLimit,
  stepAmountRules,
  type ActionCode,
  type CheckCode,
  type DraftPath,
  type TriggerCode,
  type V2Draft,
} from './workflowV2Draft.js';
import { readAddressField, readAmountField } from './workflowValidation.js';
import { workflowGuardrailFields } from './workflowFields.js';
import {
  workflowV2Action as A,
  workflowV2Check as C,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type WorkflowV2Program,
} from './workflowsV2.js';

const BPS = 10_000n;
const ZERO_ADDRESS = zeroAddress;

export interface WorkflowV2SimulationInput {
  readonly observedAmount?: bigint;
  readonly actor?: Address;
  readonly price?: bigint;
  readonly previousPrice?: bigint;
  readonly trailingHigh?: bigint;
  readonly referencePrice?: bigint;
  readonly vaultUsdcBalance?: bigint;
  readonly vaultWethBalance?: bigint;
  readonly ownerUsdcBalance?: bigint;
  readonly ownerUsdcAllowance?: bigint;
  readonly inactiveSeconds?: bigint;
  readonly inactivityGraceElapsed?: boolean;
  readonly nowSeconds?: bigint;
  readonly weeklyBudget?: {
    readonly usdcLimit: bigint;
    readonly wethLimit: bigint;
    readonly usdcSpent?: bigint;
    readonly wethSpent?: bigint;
  };
}

export interface SimulationTraceStep {
  readonly nodeIndex: number;
  readonly check: CheckCode;
  readonly checkName: string;
  readonly matched: boolean;
  readonly nextNodeIndex: number;
  readonly summary: string;
  readonly note?: string;
}

export interface SimulatedAction {
  readonly stepIndex: number;
  readonly kind: ActionCode;
  readonly name: string;
  readonly unit: typeof U.fixed | typeof U.percent;
  readonly configuredAmount: bigint;
  readonly resolvedAmount: bigint;
  readonly asset?: 'USDC' | 'WETH';
  readonly recipient?: Address;
}

export type SimulationOutcome =
  'would_execute' | 'in_grace_period' | 'skipped' | 'blocked_cap' | 'expired' | 'incomplete';

export type SimulationReason =
  | 'ok'
  | 'empty_path'
  | 'expired'
  | 'in_grace_period'
  | 'zero_amount'
  | 'no_longer_eligible'
  | 'insufficient_refill_allowance'
  | 'insufficient_owner_balance'
  | 'insufficient_vault_balance'
  | 'weekly_usdc_budget_exceeded'
  | 'weekly_weth_budget_exceeded'
  | 'usdc_cap_exceeded'
  | 'weth_cap_exceeded'
  | 'payment_cap_exceeded'
  | 'missing_inputs'
  | 'invalid_draft';

export interface SimulatedWeeklyBudget {
  readonly usdcLimit: bigint;
  readonly wethLimit: bigint;
  readonly usdcSpentBefore: bigint;
  readonly wethSpentBefore: bigint;
  readonly usdcSpentAfter: bigint;
  readonly wethSpentAfter: bigint;
}

export interface WorkflowV2SimulationResult {
  readonly outcome: SimulationOutcome;
  readonly reason: SimulationReason;
  readonly headline: string;
  readonly detail: string;
  readonly leafIndex: number | null;
  readonly trace: readonly SimulationTraceStep[];
  readonly actions: readonly SimulatedAction[];
  readonly totalUsdcSpent: bigint;
  readonly totalWethSpent: bigint;
  readonly usdcCap: bigint;
  readonly wethCap: bigint;
  readonly weeklyBudget?: SimulatedWeeklyBudget;
  readonly wouldClose: boolean;
  readonly missingFields: readonly string[];
}

export interface WorkflowV2DraftScenario {
  readonly observedAmount: string;
  readonly actor: string;
  readonly price: string;
  readonly previousPrice: string;
  readonly trailingHigh: string;
  readonly referencePrice: string;
  readonly vaultUsdcBalance: string;
  readonly inactiveSeconds: string;
  readonly inactivityGraceElapsed: boolean;
  readonly usdcWeeklySpent: string;
  readonly wethWeeklySpent: string;
  readonly simulateExpired: boolean;
}

export const emptySimulationScenario = (): WorkflowV2DraftScenario => ({
  observedAmount: '',
  actor: '',
  price: '',
  previousPrice: '',
  trailingHigh: '',
  referencePrice: '',
  vaultUsdcBalance: '',
  inactiveSeconds: '',
  inactivityGraceElapsed: false,
  usdcWeeklySpent: '',
  wethWeeklySpent: '',
  simulateExpired: false,
});

export interface SimulationFieldRequirements {
  readonly needsObservedAmount: boolean;
  readonly observedAmountUnit: 'USDC' | 'raw' | null;
  readonly needsActor: boolean;
  readonly needsPrice: boolean;
  readonly needsPreviousPrice: boolean;
  readonly needsTrailingHigh: boolean;
  readonly needsReferencePrice: boolean;
  readonly defaultReferencePrice?: string;
  readonly needsVaultUsdc: boolean;
  readonly needsInactivity: boolean;
  readonly hasInactivityPayout: boolean;
  readonly hasUsdcSpend: boolean;
  readonly hasWethSpend: boolean;
  readonly hasUsdcWeeklyBudget: boolean;
  readonly hasWethWeeklyBudget: boolean;
  readonly hasExpiry: boolean;
}

export interface SimulationPreset {
  readonly id: string;
  readonly label: string;
  readonly scenario: Partial<WorkflowV2DraftScenario>;
}

const PRICE_CHECKS = new Set<CheckCode>([
  C.priceAtLeast,
  C.priceAtMost,
  C.priceBelow,
  C.priceOutside,
  C.dipBy,
  C.trailing,
  C.aboveReference,
  C.belowReference,
  C.priceRisesThrough,
  C.priceFallsThrough,
]);

function formatCompactUnits(value: bigint, decimals: number): string {
  const raw = formatUnits(value, decimals);
  if (!raw.includes('.')) return raw;
  return raw.replace(/\.?0+$/, '');
}

function formatUsdPrice(value: bigint): string {
  const raw = formatCompactUnits(value, 18);
  const [whole, fraction] = raw.split('.');
  const formattedWhole = Number(whole).toLocaleString('en-US');
  return fraction ? `$${formattedWhole}.${fraction}` : `$${formattedWhole}`;
}

function formatPercent(bpsValue: bigint): string {
  return `${formatCompactUnits(bpsValue, 2)}%`;
}

function formatUsdc(value: bigint): string {
  return `${formatCompactUnits(value, 6)} USDC`;
}

function formatWeth(value: bigint): string {
  return `${formatCompactUnits(value, 18)} WETH`;
}

function formatObserved(value: bigint, trigger: TriggerCode): string {
  return trigger === T.payment ? formatUsdc(value) : `${value.toString()} raw`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function minBigInt(...values: readonly bigint[]): bigint {
  return values.reduce((best, current) => (current < best ? current : best));
}

function buildWeeklySnapshot(
  input: WorkflowV2SimulationInput,
  usdcDelta: bigint,
  wethDelta: bigint,
): SimulatedWeeklyBudget | undefined {
  if (!input.weeklyBudget) return undefined;
  const usdcSpentBefore = input.weeklyBudget.usdcSpent ?? 0n;
  const wethSpentBefore = input.weeklyBudget.wethSpent ?? 0n;
  return {
    usdcLimit: input.weeklyBudget.usdcLimit,
    wethLimit: input.weeklyBudget.wethLimit,
    usdcSpentBefore,
    wethSpentBefore,
    usdcSpentAfter: usdcSpentBefore + usdcDelta,
    wethSpentAfter: wethSpentBefore + wethDelta,
  };
}

function evaluateCondition(
  program: WorkflowV2Program,
  node: WorkflowV2Program['nodes'][number],
  nodeIndex: number,
  input: WorkflowV2SimulationInput,
  state: { refillThreshold: bigint; seededReference: bigint },
): SimulationTraceStep {
  const check = node.check as CheckCode;
  const checkName = checks[check]?.name ?? `Check ${check}`;
  const threshold = node.value;
  const observed = input.observedAmount ?? 0n;
  const price = input.price ?? 0n;
  const previousPrice = input.previousPrice ?? 0n;
  const trailingHigh = input.trailingHigh ?? 0n;
  const storedReference = input.referencePrice || state.seededReference;
  const vaultUsdc =
    (input.vaultUsdcBalance ?? 0n) + (program.trigger === T.payment ? observed : 0n);
  const inactiveSeconds = input.inactiveSeconds ?? 0n;
  const actor = input.actor ?? ZERO_ADDRESS;

  let matched = false;
  let summary = '';
  let note: string | undefined;

  switch (check) {
    case C.amountAtLeast: {
      matched = observed >= threshold;
      const trigger = program.trigger as TriggerCode;
      summary = `${formatObserved(observed, trigger)} ${matched ? '>=' : '<'} ${formatObserved(threshold, trigger)}`;
      break;
    }
    case C.amountAbove: {
      matched = observed > threshold;
      const trigger = program.trigger as TriggerCode;
      summary = `${formatObserved(observed, trigger)} ${matched ? '>' : '<='} ${formatObserved(threshold, trigger)}`;
      break;
    }
    case C.paymentFrom: {
      matched =
        actor.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
        actor.toLowerCase() === program.subject.toLowerCase();
      summary =
        program.subject === ZERO_ADDRESS
          ? 'Watched wallet not set'
          : matched
            ? `Sender ${shortAddress(actor)} matches ${shortAddress(program.subject)}`
            : `Sender ${actor === ZERO_ADDRESS ? 'unknown' : shortAddress(actor)} != ${shortAddress(program.subject)}`;
      break;
    }
    case C.usdcBelow: {
      matched = vaultUsdc < threshold;
      if (matched) state.refillThreshold = threshold;
      summary = `Vault ${formatUsdc(vaultUsdc)} ${matched ? '<' : '>='} ${formatUsdc(threshold)}`;
      break;
    }
    case C.inactivity: {
      matched = inactiveSeconds >= threshold;
      summary = `${inactiveSeconds.toString()} s ${matched ? '>=' : '<'} ${threshold.toString()} s`;
      break;
    }
    case C.priceAtLeast: {
      matched = price > 0n && price >= threshold;
      summary = `${formatUsdPrice(price)} ${matched ? '>=' : '<'} ${formatUsdPrice(threshold)}`;
      break;
    }
    case C.priceAtMost: {
      matched = price > 0n && price <= threshold;
      summary = `${formatUsdPrice(price)} ${matched ? '<=' : '>'} ${formatUsdPrice(threshold)}`;
      break;
    }
    case C.priceBelow: {
      matched = price > 0n && price < threshold;
      summary = `${formatUsdPrice(price)} ${matched ? '<' : '>='} ${formatUsdPrice(threshold)}`;
      break;
    }
    case C.priceOutside: {
      matched = price > 0n && (price < threshold || price > node.upper);
      summary = matched
        ? `${formatUsdPrice(price)} outside ${formatUsdPrice(threshold)} to ${formatUsdPrice(node.upper)}`
        : `${formatUsdPrice(price)} within ${formatUsdPrice(threshold)} to ${formatUsdPrice(node.upper)}`;
      break;
    }
    case C.dipBy: {
      if (storedReference === 0n) {
        matched = false;
        if (price > 0n) state.seededReference = price;
        summary = `No baseline price yet (seeds ${formatUsdPrice(price)})`;
        note = 'First run seeds the baseline price on-chain and skips.';
      } else {
        const target = (storedReference * (BPS - threshold)) / BPS;
        matched = price > 0n && price <= target;
        summary = `${formatUsdPrice(price)} ${matched ? '<=' : '>'} ${formatUsdPrice(target)} (-${formatPercent(threshold)} from ${formatUsdPrice(storedReference)})`;
        if (!matched && price > storedReference) {
          state.seededReference = price;
          note = `Price is above the baseline and updates it to ${formatUsdPrice(price)}.`;
        }
      }
      break;
    }
    case C.trailing: {
      const effectivePeak = trailingHigh > price ? trailingHigh : price;
      const target = effectivePeak > 0n ? (effectivePeak * (BPS - threshold)) / BPS : 0n;
      matched = price > 0n && effectivePeak > 0n && price <= target;
      summary =
        effectivePeak > 0n
          ? `${formatUsdPrice(price)} ${matched ? '<=' : '>'} ${formatUsdPrice(target)} (-${formatPercent(threshold)} from ${formatUsdPrice(effectivePeak)} high)`
          : 'Enter pool price and trailing high';
      if (price > trailingHigh && price > 0n) {
        note = `New high: Vault updates trailing peak to ${formatUsdPrice(price)}.`;
      }
      break;
    }
    case C.aboveReference: {
      const reference =
        storedReference > 0n ? storedReference : node.upper > 0n ? node.upper : price;
      if (storedReference === 0n && reference > 0n) state.seededReference = reference;
      const target = reference > 0n ? (reference * (BPS + threshold)) / BPS : 0n;
      matched = price > 0n && reference > 0n && price >= target;
      summary = `${formatUsdPrice(price)} ${matched ? '>=' : '<'} ${formatUsdPrice(target)} (+${formatPercent(threshold)} from ${formatUsdPrice(reference)})`;
      if (storedReference === 0n && node.upper === 0n && price > 0n) {
        note = 'No starting reference set; first run seeds the current pool price.';
      }
      break;
    }
    case C.belowReference: {
      const reference =
        storedReference > 0n ? storedReference : node.upper > 0n ? node.upper : price;
      if (storedReference === 0n && reference > 0n) state.seededReference = reference;
      const target = reference > 0n ? (reference * (BPS - threshold)) / BPS : 0n;
      matched = price > 0n && reference > 0n && price <= target;
      summary = `${formatUsdPrice(price)} ${matched ? '<=' : '>'} ${formatUsdPrice(target)} (-${formatPercent(threshold)} from ${formatUsdPrice(reference)})`;
      if (storedReference === 0n && node.upper === 0n && price > 0n) {
        note = 'No starting reference set; first run seeds the current pool price.';
      }
      break;
    }
    case C.priceRisesThrough: {
      matched = previousPrice > 0n && price > 0n && previousPrice < threshold && price >= threshold;
      summary = `${formatUsdPrice(previousPrice)} -> ${formatUsdPrice(price)} (target ${formatUsdPrice(threshold)})`;
      if (previousPrice === 0n) {
        note = 'Needs a prior observed price before crossing can match.';
      }
      break;
    }
    case C.priceFallsThrough: {
      matched = previousPrice > 0n && price > 0n && previousPrice >= threshold && price < threshold;
      summary = `${formatUsdPrice(previousPrice)} -> ${formatUsdPrice(price)} (target ${formatUsdPrice(threshold)})`;
      if (previousPrice === 0n) {
        note = 'Needs a prior observed price before crossing can match.';
      }
      break;
    }
    default: {
      matched = false;
      summary = 'Unsupported condition';
      break;
    }
  }

  return {
    nodeIndex,
    check,
    checkName,
    matched,
    nextNodeIndex: matched ? node.yes : node.no,
    summary,
    note,
  };
}

/**
 * Mirrors `WorkflowVaultV2.settle` / `_evaluate` / `_actions` client-side using exact `bigint` math.
 */
export function simulateWorkflowV2Program(
  program: WorkflowV2Program,
  input: WorkflowV2SimulationInput = {},
): WorkflowV2SimulationResult {
  const nowSeconds = input.nowSeconds ?? BigInt(Math.floor(Date.now() / 1_000));
  if (program.expires !== 0n && nowSeconds > program.expires) {
    return {
      outcome: 'expired',
      reason: 'expired',
      headline: 'Expired — run skipped',
      detail: 'The workflow expiry timestamp is in the past, so the Vault returns EXPIRED.',
      leafIndex: null,
      trace: [],
      actions: [],
      totalUsdcSpent: 0n,
      totalWethSpent: 0n,
      usdcCap: program.usdcCap,
      wethCap: program.wethCap,
      weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
      wouldClose: false,
      missingFields: [],
    };
  }

  const trace: SimulationTraceStep[] = [];
  const state = { refillThreshold: 0n, seededReference: 0n };
  const visited = new Set<number>();
  let cursor = 0;

  while (cursor < program.nodes.length) {
    if (visited.has(cursor)) {
      return {
        outcome: 'incomplete',
        reason: 'invalid_draft',
        headline: 'Cycle detected',
        detail: 'This workflow graph contains a loop and cannot be evaluated.',
        leafIndex: null,
        trace,
        actions: [],
        totalUsdcSpent: 0n,
        totalWethSpent: 0n,
        usdcCap: program.usdcCap,
        wethCap: program.wethCap,
        weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
        wouldClose: false,
        missingFields: [],
      };
    }
    visited.add(cursor);
    const node = program.nodes[cursor];
    if (!node || node.check === 0) break;
    const step = evaluateCondition(program, node, cursor, input, state);
    trace.push(step);
    cursor = step.nextNodeIndex;
  }

  const leaf = program.nodes[cursor];
  if (!leaf || leaf.check !== 0) {
    return {
      outcome: 'incomplete',
      reason: 'invalid_draft',
      headline: 'Invalid path',
      detail: 'The condition branch does not reach a valid action or skip node.',
      leafIndex: null,
      trace,
      actions: [],
      totalUsdcSpent: 0n,
      totalWethSpent: 0n,
      usdcCap: program.usdcCap,
      wethCap: program.wethCap,
      weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
      wouldClose: false,
      missingFields: [],
    };
  }

  if (leaf.actions.length === 0) {
    return {
      outcome: 'skipped',
      reason: 'empty_path',
      headline: 'Skipped — matched Do nothing',
      detail:
        'The scenario reached an empty path, so the Vault records SKIPPED and spends nothing.',
      leafIndex: cursor,
      trace,
      actions: [],
      totalUsdcSpent: 0n,
      totalWethSpent: 0n,
      usdcCap: program.usdcCap,
      wethCap: program.wethCap,
      weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
      wouldClose: false,
      missingFields: [],
    };
  }

  const observed = input.observedAmount ?? 0n;
  const firstAction = leaf.actions[0];
  if (firstAction && firstAction.kind === A.inactivityPayout && !input.inactivityGraceElapsed) {
    const preview: SimulatedAction[] = [
      {
        stepIndex: 0,
        kind: firstAction.kind as ActionCode,
        name: actions[firstAction.kind as ActionCode].name,
        unit: firstAction.unit === U.percent ? U.percent : U.fixed,
        configuredAmount: firstAction.amount,
        resolvedAmount: firstAction.amount,
        asset: actions[firstAction.kind as ActionCode].asset === 'USDC' ? 'USDC' : undefined,
        recipient: firstAction.account === ZERO_ADDRESS ? undefined : firstAction.account,
      },
    ];
    return {
      outcome: 'in_grace_period',
      reason: 'in_grace_period',
      headline: 'Starts 24-hour grace period',
      detail:
        'The first eligible run starts a 24-hour grace period. An eligible run after that starts a final callback waiting period. The payout can proceed on a run dispatched after both waiting periods, if there has been no check-in.',
      leafIndex: cursor,
      trace,
      actions: preview,
      totalUsdcSpent: 0n,
      totalWethSpent: 0n,
      usdcCap: program.usdcCap,
      wethCap: program.wethCap,
      weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
      wouldClose: false,
      missingFields: [],
    };
  }

  let usdcSpent = 0n;
  let wethSpent = 0n;
  let runningVaultUsdc =
    input.vaultUsdcBalance !== undefined
      ? program.trigger === T.payment
        ? input.vaultUsdcBalance + observed
        : input.vaultUsdcBalance
      : undefined;
  let runningVaultWeth = input.vaultWethBalance;
  const usdcLimit = input.weeklyBudget?.usdcLimit ?? 0n;
  const wethLimit = input.weeklyBudget?.wethLimit ?? 0n;
  const usdcSpentBefore = input.weeklyBudget?.usdcSpent ?? 0n;
  const wethSpentBefore = input.weeklyBudget?.wethSpent ?? 0n;
  const resolvedActions: SimulatedAction[] = [];

  for (let index = 0; index < leaf.actions.length; index += 1) {
    const step = leaf.actions[index]!;
    const kind = step.kind as ActionCode;
    const unit = step.unit === U.percent ? U.percent : U.fixed;
    const meta = actions[kind];
    let amount = unit === U.percent ? (observed * step.amount) / BPS : step.amount;

    const skipWith = (reason: SimulationReason, headline: string, detail: string) => ({
      outcome: 'skipped' as const,
      reason,
      headline,
      detail,
      leafIndex: cursor,
      trace,
      actions: [] as SimulatedAction[],
      totalUsdcSpent: usdcSpent,
      totalWethSpent: wethSpent,
      usdcCap: program.usdcCap,
      wethCap: program.wethCap,
      weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
      wouldClose: false,
      missingFields: [],
    });

    const blockCapWith = (reason: SimulationReason, headline: string, detail: string) => ({
      outcome: 'blocked_cap' as const,
      reason,
      headline,
      detail,
      leafIndex: cursor,
      trace,
      actions: [] as SimulatedAction[],
      totalUsdcSpent: usdcSpent,
      totalWethSpent: wethSpent,
      usdcCap: program.usdcCap,
      wethCap: program.wethCap,
      weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
      wouldClose: false,
      missingFields: [],
    });

    if (amount === 0n && kind !== A.alert) {
      return skipWith(
        'zero_amount',
        'Skipped — step amount rounds to zero',
        `${meta.name} resolved to 0 from the simulated input, so the Vault reverts with NoLongerEligible and skips the run.`,
      );
    }

    if (kind === A.sell) {
      wethSpent += amount;
      if (wethLimit !== 0n && wethSpentBefore + wethSpent > wethLimit) {
        return skipWith(
          'weekly_weth_budget_exceeded',
          'Skipped — weekly WETH budget exceeded',
          `This run needs ${formatWeth(wethSpent)}, which exceeds the remaining ${formatWeth(wethLimit > wethSpentBefore ? wethLimit - wethSpentBefore : 0n)} of the ${formatWeth(wethLimit)} weekly WETH budget.`,
        );
      }
    } else {
      if (kind === A.refill) {
        const balance = runningVaultUsdc ?? 0n;
        if (balance >= state.refillThreshold) {
          return skipWith(
            'no_longer_eligible',
            'Skipped — Vault balance already at floor',
            `Vault USDC (${formatUsdc(balance)}) is at or above the ${formatUsdc(state.refillThreshold)} floor.`,
          );
        }
        let needed = minBigInt(amount, state.refillThreshold - balance);
        if (usdcLimit !== 0n) {
          const remaining = usdcLimit - usdcSpentBefore - usdcSpent;
          if (remaining <= 0n) {
            return skipWith(
              'weekly_usdc_budget_exceeded',
              'Skipped — weekly USDC budget exhausted',
              'This refill has no remaining weekly USDC budget.',
            );
          }
          needed = minBigInt(needed, remaining);
        }
        if (input.ownerUsdcAllowance !== undefined && input.ownerUsdcAllowance === 0n) {
          return skipWith(
            'insufficient_refill_allowance',
            'Skipped — missing USDC refill allowance',
            `The Vault needs ${formatUsdc(needed)} from the owner wallet, but USDC allowance is 0.`,
          );
        }
        if (input.ownerUsdcBalance !== undefined && input.ownerUsdcBalance === 0n) {
          return skipWith(
            'insufficient_owner_balance',
            'Skipped — owner wallet has 0 USDC',
            `The Vault needs ${formatUsdc(needed)} from the owner wallet, but the owner balance is 0 USDC.`,
          );
        }
        amount = minBigInt(
          needed,
          input.ownerUsdcAllowance ?? needed,
          input.ownerUsdcBalance ?? needed,
        );
        if (runningVaultUsdc !== undefined) runningVaultUsdc += amount;
      }
      usdcSpent += amount;
      if (kind !== A.alert && usdcLimit !== 0n && usdcSpentBefore + usdcSpent > usdcLimit) {
        return skipWith(
          'weekly_usdc_budget_exceeded',
          'Skipped — weekly USDC budget exceeded',
          `This run needs ${formatUsdc(usdcSpent)}, which exceeds the remaining ${formatUsdc(usdcLimit > usdcSpentBefore ? usdcLimit - usdcSpentBefore : 0n)} of the ${formatUsdc(usdcLimit)} weekly USDC budget.`,
        );
      }
    }

    if (usdcSpent > program.usdcCap) {
      return blockCapWith(
        'usdc_cap_exceeded',
        'Blocked by per-run USDC cap',
        `This path spends ${formatUsdc(usdcSpent)}, above the ${formatUsdc(program.usdcCap)} per-run USDC cap. Raise the cap or lower the step amount.`,
      );
    }
    if (wethSpent > program.wethCap) {
      return blockCapWith(
        'weth_cap_exceeded',
        'Blocked by per-run WETH cap',
        `This path sells ${formatWeth(wethSpent)}, above the ${formatWeth(program.wethCap)} per-run WETH cap. Raise the cap or lower the sale amount.`,
      );
    }
    if (program.trigger === T.payment && usdcSpent > observed) {
      return blockCapWith(
        'payment_cap_exceeded',
        'Blocked — spend exceeds incoming payment',
        `Payment workflows cannot spend more USDC (${formatUsdc(usdcSpent)}) than the incoming payment (${formatUsdc(observed)}).`,
      );
    }

    if (kind === A.send || kind === A.inactivityPayout || kind === A.buy) {
      if (runningVaultUsdc !== undefined) {
        if (runningVaultUsdc < amount) {
          return skipWith(
            'insufficient_vault_balance',
            'Skipped — insufficient Vault USDC balance',
            `${meta.name} needs ${formatUsdc(amount)}, but the Vault only holds ${formatUsdc(runningVaultUsdc)}.`,
          );
        }
        runningVaultUsdc -= amount;
      }
    } else if (kind === A.sell && runningVaultWeth !== undefined) {
      if (runningVaultWeth < amount) {
        return skipWith(
          'insufficient_vault_balance',
          'Skipped — insufficient Vault WETH balance',
          `${meta.name} needs ${formatWeth(amount)}, but the Vault only holds ${formatWeth(runningVaultWeth)}.`,
        );
      }
      runningVaultWeth -= amount;
    }

    resolvedActions.push({
      stepIndex: index,
      kind,
      name: meta.name,
      unit,
      configuredAmount: step.amount,
      resolvedAmount: amount,
      asset: meta.asset === 'USDC' || meta.asset === 'WETH' ? meta.asset : undefined,
      recipient: step.account === ZERO_ADDRESS ? undefined : step.account,
    });
  }

  const summaryNames = resolvedActions.map((action) => action.name).join(', ');
  return {
    outcome: 'would_execute',
    reason: 'ok',
    headline: `Would execute ${resolvedActions.length} ${resolvedActions.length === 1 ? 'action' : 'actions'}`,
    detail: `Matched conditions and passed the checks modeled by this dry run: ${summaryNames}.`,
    leafIndex: cursor,
    trace,
    actions: resolvedActions,
    totalUsdcSpent: usdcSpent,
    totalWethSpent: wethSpent,
    usdcCap: program.usdcCap,
    wethCap: program.wethCap,
    weeklyBudget: buildWeeklySnapshot(input, usdcSpent, wethSpent),
    wouldClose: program.once,
    missingFields: [],
  };
}

export function requiredSimulationInputs(draft: V2Draft): SimulationFieldRequirements {
  let needsActor = false;
  let needsPrice = false;
  let needsPreviousPrice = false;
  let needsTrailingHigh = false;
  let needsReferencePrice = false;
  let defaultReferencePrice: string | undefined;
  let needsVaultUsdc = false;
  let needsInactivity = false;
  let hasInactivityPayout = false;
  let hasUsdcSpend = false;
  let hasWethSpend = false;

  function visit(path: DraftPath) {
    if ('steps' in path) {
      for (const step of path.steps) {
        if (step.kind === A.inactivityPayout) hasInactivityPayout = true;
        const asset = actions[step.kind].asset;
        if (asset === 'USDC') hasUsdcSpend = true;
        if (asset === 'WETH') hasWethSpend = true;
      }
      return;
    }
    if (path.check === C.paymentFrom) needsActor = true;
    if (PRICE_CHECKS.has(path.check)) needsPrice = true;
    if (path.check === C.priceRisesThrough || path.check === C.priceFallsThrough) {
      needsPreviousPrice = true;
    }
    if (path.check === C.trailing) needsTrailingHigh = true;
    if (
      path.check === C.dipBy ||
      path.check === C.aboveReference ||
      path.check === C.belowReference
    ) {
      needsReferencePrice = true;
      if (!defaultReferencePrice && path.upper.trim()) {
        defaultReferencePrice = path.upper.trim();
      }
    }
    if (path.check === C.usdcBelow) needsVaultUsdc = true;
    if (path.check === C.inactivity) needsInactivity = true;
    visit(path.yes);
    visit(path.no);
  }

  visit(draft.root);

  const needsObservedAmount = draft.trigger === T.payment || draft.trigger === T.transfer;
  return {
    needsObservedAmount,
    observedAmountUnit:
      draft.trigger === T.payment ? 'USDC' : draft.trigger === T.transfer ? 'raw' : null,
    needsActor,
    needsPrice,
    needsPreviousPrice,
    needsTrailingHigh,
    needsReferencePrice,
    defaultReferencePrice,
    needsVaultUsdc,
    needsInactivity,
    hasInactivityPayout,
    hasUsdcSpend,
    hasWethSpend,
    hasUsdcWeeklyBudget: Boolean(draft.usdcWeeklyBudget.trim()),
    hasWethWeeklyBudget: Boolean(draft.wethWeeklyBudget.trim()),
    hasExpiry: Boolean(draft.expires.trim()),
  };
}

function tryReadOptionalNumber(value: string, decimals: number): bigint | undefined | 'invalid' {
  const text = value.trim();
  if (!text) return undefined;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return 'invalid';
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length > decimals) return 'invalid';
  return parseUnits(text, decimals);
}

function tryReadOptionalAddress(value: string): Address | undefined | 'invalid' {
  const text = value.trim();
  if (!text) return undefined;
  try {
    return readAddressField(text, { noun: 'a wallet address' });
  } catch {
    return 'invalid';
  }
}

/**
 * Evaluates an in-progress builder draft without requiring unrelated activation fields such as
 * title, slippage, or payout recipients. Reports exact missing fields if the traversed path
 * cannot be resolved yet.
 */
export function simulateWorkflowV2Draft(
  draft: V2Draft,
  scenario: WorkflowV2DraftScenario,
  nowSeconds = BigInt(Math.floor(Date.now() / 1_000)),
): WorkflowV2SimulationResult {
  const missingFields: string[] = [];
  const requirements = requiredSimulationInputs(draft);

  const usdcCap = (() => {
    try {
      return readAmountField(draft.usdcCap, workflowGuardrailFields.usdcCap);
    } catch {
      missingFields.push(workflowGuardrailFields.usdcCap.label);
      return 0n;
    }
  })();
  const wethCap = (() => {
    try {
      return readAmountField(draft.wethCap, workflowGuardrailFields.wethCap);
    } catch {
      missingFields.push(workflowGuardrailFields.wethCap.label);
      return 0n;
    }
  })();

  let usdcLimit = 0n;
  let wethLimit = 0n;
  try {
    usdcLimit = readWeeklyLimit(draft.usdcWeeklyBudget, 'USDC');
  } catch {
    missingFields.push('Weekly USDC budget');
  }
  try {
    wethLimit = readWeeklyLimit(draft.wethWeeklyBudget, 'WETH');
  } catch {
    missingFields.push('Weekly WETH budget');
  }

  let expires = 0n;
  try {
    if (draft.expires.trim()) {
      expires = readAmountField(draft.expires, {
        ...workflowGuardrailFields.expires,
        future: false,
      });
    }
  } catch {
    missingFields.push(workflowGuardrailFields.expires.label);
  }

  let subject: Address = ZERO_ADDRESS;
  if (draft.subject.trim()) {
    const parsedSubject = tryReadOptionalAddress(draft.subject);
    if (parsedSubject === 'invalid') {
      missingFields.push('Watched wallet address');
    } else if (parsedSubject) {
      subject = parsedSubject;
    }
  }

  const parsedObserved = tryReadOptionalNumber(
    requirements.needsObservedAmount ? scenario.observedAmount : '',
    draft.trigger === T.payment ? 6 : 0,
  );
  const parsedPrice = tryReadOptionalNumber(requirements.needsPrice ? scenario.price : '', 18);
  const parsedPreviousPrice = tryReadOptionalNumber(
    requirements.needsPreviousPrice ? scenario.previousPrice : '',
    18,
  );
  const parsedTrailingHigh = tryReadOptionalNumber(
    requirements.needsTrailingHigh ? scenario.trailingHigh : '',
    18,
  );
  const parsedReferencePrice = tryReadOptionalNumber(
    requirements.needsReferencePrice ? scenario.referencePrice : '',
    18,
  );
  const parsedVaultUsdc = tryReadOptionalNumber(
    requirements.needsVaultUsdc ? scenario.vaultUsdcBalance : '',
    6,
  );
  const parsedInactive = tryReadOptionalNumber(
    requirements.needsInactivity ? scenario.inactiveSeconds : '',
    0,
  );
  const parsedActor = tryReadOptionalAddress(requirements.needsActor ? scenario.actor : '');
  const parsedUsdcSpent = tryReadOptionalNumber(
    requirements.hasUsdcSpend || requirements.hasUsdcWeeklyBudget ? scenario.usdcWeeklySpent : '',
    6,
  );
  const parsedWethSpent = tryReadOptionalNumber(
    requirements.hasWethSpend || requirements.hasWethWeeklyBudget ? scenario.wethWeeklySpent : '',
    18,
  );

  if (parsedObserved === 'invalid') missingFields.push('Incoming amount');
  if (parsedPrice === 'invalid') missingFields.push('Pool price');
  if (parsedPreviousPrice === 'invalid') missingFields.push('Previous pool price');
  if (parsedTrailingHigh === 'invalid') missingFields.push('Trailing high price');
  if (parsedReferencePrice === 'invalid') missingFields.push('Baseline / reference price');
  if (parsedVaultUsdc === 'invalid') missingFields.push('Vault USDC balance');
  if (parsedInactive === 'invalid') missingFields.push('Inactive time (seconds)');
  if (parsedActor === 'invalid') missingFields.push('Sender wallet address');
  if (parsedUsdcSpent === 'invalid') missingFields.push('Already spent this week (USDC)');
  if (parsedWethSpent === 'invalid') missingFields.push('Already spent this week (WETH)');

  const effectiveNow = scenario.simulateExpired && expires > 0n ? expires + 1n : nowSeconds;

  // Build lenient program nodes preserving exact pre-order DFS indexing matching `diagramV2`.
  const nodes: {
    check: number;
    yes: number;
    no: number;
    value: bigint;
    upper: bigint;
    actions: WorkflowV2Program['nodes'][number]['actions'];
  }[] = [];
  const nodeDraftMap: DraftPath[] = [];

  function buildLenient(path: DraftPath): number {
    const index = nodes.length;
    nodeDraftMap.push(path);
    if ('steps' in path) {
      nodes.push({
        check: 0,
        yes: 0,
        no: 0,
        value: 0n,
        upper: 0n,
        actions: path.steps.map((step) => {
          const parsedAmount = actions[step.kind].asset
            ? tryReadOptionalNumber(step.amount, actionDecimals(step.kind, step.unit))
            : 0n;
          const parsedRecipient = actions[step.kind].recipient
            ? tryReadOptionalAddress(step.recipient)
            : ZERO_ADDRESS;
          return {
            kind: step.kind,
            unit: step.unit,
            amount: typeof parsedAmount === 'bigint' ? parsedAmount : 0n,
            account:
              parsedRecipient && parsedRecipient !== 'invalid' ? parsedRecipient : ZERO_ADDRESS,
          };
        }),
      });
      return index;
    }

    const decimals =
      checks[path.check].decimals === undefined
        ? undefined
        : checkDecimals(path.check, draft.trigger);
    const parsedValue = decimals === undefined ? 0n : tryReadOptionalNumber(path.value, decimals);
    const parsedUpper = checks[path.check].upper ? tryReadOptionalNumber(path.upper, 18) : 0n;

    const node = {
      check: path.check,
      yes: 0,
      no: 0,
      value: typeof parsedValue === 'bigint' ? parsedValue : 0n,
      upper: typeof parsedUpper === 'bigint' ? parsedUpper : 0n,
      actions: [] as WorkflowV2Program['nodes'][number]['actions'],
    };
    nodes.push(node);
    node.yes = buildLenient(path.yes);
    node.no = buildLenient(path.no);
    return index;
  }

  buildLenient(draft.root);

  if (missingFields.length > 0) {
    return {
      outcome: 'incomplete',
      reason: 'missing_inputs',
      headline: 'Check input formatting',
      detail: `Fix or finish ${missingFields.join(', ')} to run the simulation.`,
      leafIndex: null,
      trace: [],
      actions: [],
      totalUsdcSpent: 0n,
      totalWethSpent: 0n,
      usdcCap,
      wethCap,
      wouldClose: false,
      missingFields,
    };
  }

  const parsedInterval = tryReadOptionalNumber(draft.interval, 0);
  const program: WorkflowV2Program = {
    chain: draft.chain,
    originChain: draft.originChain,
    trigger: draft.trigger,
    interval: typeof parsedInterval === 'bigint' ? Number(parsedInterval) : 0,
    expires,
    source: ZERO_ADDRESS,
    subject,
    usdcCap,
    wethCap,
    slippage: 0,
    once: draft.once,
    nodes,
  };

  if (program.expires !== 0n && effectiveNow > program.expires) {
    return simulateWorkflowV2Program(program, {
      nowSeconds: effectiveNow,
      weeklyBudget: {
        usdcLimit,
        wethLimit,
        usdcSpent: typeof parsedUsdcSpent === 'bigint' ? parsedUsdcSpent : 0n,
        wethSpent: typeof parsedWethSpent === 'bigint' ? parsedWethSpent : 0n,
      },
    });
  }

  // Verify required values along the traversed path before returning a final verdict.
  const pathMissing: string[] = [];
  let cursor = 0;
  const trace: SimulationTraceStep[] = [];
  const state = { refillThreshold: 0n, seededReference: 0n };
  const visited = new Set<number>();

  const input: WorkflowV2SimulationInput = {
    observedAmount: typeof parsedObserved === 'bigint' ? parsedObserved : undefined,
    actor: parsedActor && parsedActor !== 'invalid' ? parsedActor : undefined,
    price: typeof parsedPrice === 'bigint' ? parsedPrice : undefined,
    previousPrice: typeof parsedPreviousPrice === 'bigint' ? parsedPreviousPrice : undefined,
    trailingHigh: typeof parsedTrailingHigh === 'bigint' ? parsedTrailingHigh : undefined,
    referencePrice: typeof parsedReferencePrice === 'bigint' ? parsedReferencePrice : undefined,
    vaultUsdcBalance: typeof parsedVaultUsdc === 'bigint' ? parsedVaultUsdc : undefined,
    inactiveSeconds: typeof parsedInactive === 'bigint' ? parsedInactive : undefined,
    inactivityGraceElapsed: scenario.inactivityGraceElapsed,
    nowSeconds: effectiveNow,
    weeklyBudget:
      usdcLimit > 0n ||
      wethLimit > 0n ||
      (typeof parsedUsdcSpent === 'bigint' && parsedUsdcSpent > 0n) ||
      (typeof parsedWethSpent === 'bigint' && parsedWethSpent > 0n)
        ? {
            usdcLimit,
            wethLimit,
            usdcSpent: typeof parsedUsdcSpent === 'bigint' ? parsedUsdcSpent : 0n,
            wethSpent: typeof parsedWethSpent === 'bigint' ? parsedWethSpent : 0n,
          }
        : undefined,
  };

  while (cursor < nodes.length) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const draftNode = nodeDraftMap[cursor];
    const programNode = nodes[cursor];
    if (!draftNode || !programNode || 'steps' in draftNode) break;

    const checkMeta = checks[draftNode.check];
    let lowerThresholdValid = true;
    if (checkMeta.decimals !== undefined) {
      try {
        readAmountField(draftNode.value, checkThresholdRules(draftNode.check, draft.trigger));
      } catch {
        lowerThresholdValid = false;
        pathMissing.push(`${checkMeta.name} threshold on canvas`);
      }
    }
    if (draftNode.check === C.priceOutside) {
      try {
        const upper = readAmountField(draftNode.upper, checkUpperRules(draftNode.check));
        if (lowerThresholdValid) {
          const lower = readAmountField(
            draftNode.value,
            checkThresholdRules(draftNode.check, draft.trigger),
          );
          if (upper <= lower) pathMissing.push('Upper price above lower price on canvas');
        }
      } catch {
        pathMissing.push('Upper price on canvas');
      }
    } else if (checkMeta.upper && draftNode.upper.trim()) {
      try {
        readAmountField(draftNode.upper, checkUpperRules(draftNode.check));
      } catch {
        pathMissing.push(`${checkMeta.upper} on canvas`);
      }
    }

    if (draftNode.check === C.paymentFrom && subject === ZERO_ADDRESS) {
      pathMissing.push('Watched wallet address on workflow trigger');
    }

    if (
      (draftNode.check === C.amountAtLeast || draftNode.check === C.amountAbove) &&
      input.observedAmount === undefined
    ) {
      pathMissing.push(draft.trigger === T.payment ? 'Incoming payment (USDC)' : 'Transfer amount');
    }
    if (draftNode.check === C.paymentFrom && !input.actor) {
      pathMissing.push('Sender wallet address');
    }
    if (draftNode.check === C.usdcBelow && input.vaultUsdcBalance === undefined) {
      pathMissing.push('Vault USDC balance');
    }
    if (draftNode.check === C.inactivity && input.inactiveSeconds === undefined) {
      pathMissing.push('Time without activity (seconds)');
    }
    if (PRICE_CHECKS.has(draftNode.check) && input.price === undefined) {
      pathMissing.push('Pool price (USDC per WETH)');
    }
    if (
      (draftNode.check === C.priceRisesThrough || draftNode.check === C.priceFallsThrough) &&
      input.previousPrice === undefined
    ) {
      pathMissing.push('Previous pool price (USDC per WETH)');
    }
    if (
      draftNode.check === C.trailing &&
      input.trailingHigh === undefined &&
      input.price === undefined
    ) {
      pathMissing.push('Trailing high price');
    }

    if (pathMissing.length > 0) {
      return {
        outcome: 'incomplete',
        reason: 'missing_inputs',
        headline: 'Enter scenario values to trace this branch',
        detail: `Missing ${pathMissing.join(', ')}.`,
        leafIndex: null,
        trace,
        actions: [],
        totalUsdcSpent: 0n,
        totalWethSpent: 0n,
        usdcCap,
        wethCap,
        weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
        wouldClose: false,
        missingFields: pathMissing,
      };
    }

    const step = evaluateCondition(program, programNode, cursor, input, state);
    trace.push(step);
    cursor = step.nextNodeIndex;
  }

  const reachedLeaf = nodeDraftMap[cursor];
  if (reachedLeaf && 'steps' in reachedLeaf && reachedLeaf.steps.length > 0) {
    if (
      draft.trigger === T.payment &&
      input.observedAmount === undefined &&
      reachedLeaf.steps.some((step) => actions[step.kind].asset === 'USDC')
    ) {
      pathMissing.push('Incoming payment (USDC)');
    }
    for (const step of reachedLeaf.steps) {
      if (actions[step.kind].asset) {
        try {
          readAmountField(step.amount, stepAmountRules(step.kind, step.unit));
        } catch {
          pathMissing.push(`${actions[step.kind].name} amount on matched path`);
        }
      }
    }
    if (pathMissing.length > 0) {
      return {
        outcome: 'incomplete',
        reason: 'missing_inputs',
        headline: 'Matched path needs configuration',
        detail: `Missing ${pathMissing.join(', ')}.`,
        leafIndex: cursor,
        trace,
        actions: [],
        totalUsdcSpent: 0n,
        totalWethSpent: 0n,
        usdcCap,
        wethCap,
        weeklyBudget: buildWeeklySnapshot(input, 0n, 0n),
        wouldClose: false,
        missingFields: pathMissing,
      };
    }
  }

  return simulateWorkflowV2Program(program, input);
}

function collectThresholds(root: DraftPath, trigger: TriggerCode) {
  const conditions: { check: CheckCode; value: bigint; upper: bigint }[] = [];
  function visit(path: DraftPath) {
    if ('steps' in path) return;
    const decimals =
      checks[path.check].decimals === undefined ? undefined : checkDecimals(path.check, trigger);
    const value = decimals !== undefined ? (tryReadOptionalNumber(path.value, decimals) ?? 0n) : 0n;
    const upper = checks[path.check].upper ? (tryReadOptionalNumber(path.upper, 18) ?? 0n) : 0n;
    if (typeof value === 'bigint' && typeof upper === 'bigint') {
      conditions.push({ check: path.check, value, upper });
    }
    visit(path.yes);
    visit(path.no);
  }
  visit(root);
  return conditions;
}

function scalePercentDown(base: bigint, bps: bigint): bigint {
  const clamped = bps >= BPS ? BPS - 1n : bps;
  return (base * (BPS - clamped)) / BPS;
}

function scalePercentUp(base: bigint, bps: bigint): bigint {
  return (base * (BPS + bps)) / BPS;
}

function hitDownBps(thresholdBps: bigint): bigint {
  return thresholdBps + 200n < BPS ? thresholdBps + 200n : thresholdBps;
}

/**
 * Generates 2-4 concrete scenario presets directly from the draft's configured thresholds so any
 * recipe or custom 3-branch tree has instant one-click dry-run scenarios.
 */
export function buildSimulationPresets(draft: V2Draft): readonly SimulationPreset[] {
  const conditions = collectThresholds(draft.root, draft.trigger);
  const reqs = requiredSimulationInputs(draft);
  const presets: SimulationPreset[] = [];

  if (draft.trigger === T.payment) {
    const amountThresholds = conditions
      .filter((c) => (c.check === C.amountAtLeast || c.check === C.amountAbove) && c.value > 0n)
      .map((c) => c.value)
      .sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));

    const senderOverride =
      reqs.needsActor && draft.subject.trim() ? { actor: draft.subject.trim() } : {};

    if (amountThresholds.length >= 2) {
      const high = amountThresholds[0]!;
      const low = amountThresholds[amountThresholds.length - 1]!;
      const topUsesAbove = conditions.some((c) => c.check === C.amountAbove && c.value === high);
      const topAmount = topUsesAbove ? high + parseUnits('0.1', 6) : high;
      const middle = (high + low) / 2n;
      const below = low > 100_000n ? low / 2n : low > 1n ? low - 1n : 0n;
      presets.push(
        {
          id: 'payment-top',
          label: `Large (${formatCompactUnits(topAmount, 6)} USDC)`,
          scenario: { observedAmount: formatCompactUnits(topAmount, 6), ...senderOverride },
        },
        {
          id: 'payment-mid',
          label: `Middle (${formatCompactUnits(middle, 6)} USDC)`,
          scenario: { observedAmount: formatCompactUnits(middle, 6), ...senderOverride },
        },
        {
          id: 'payment-low',
          label: `Small (${formatCompactUnits(below, 6)} USDC)`,
          scenario: { observedAmount: formatCompactUnits(below, 6), ...senderOverride },
        },
      );
    } else if (amountThresholds.length === 1) {
      const threshold = amountThresholds[0]!;
      const above = threshold + parseUnits('0.5', 6);
      const below = threshold > 100_000n ? threshold / 2n : threshold > 1n ? threshold - 1n : 0n;
      presets.push(
        {
          id: 'payment-match',
          label: `Qualifies (${formatCompactUnits(above, 6)} USDC)`,
          scenario: { observedAmount: formatCompactUnits(above, 6), ...senderOverride },
        },
        {
          id: 'payment-skip',
          label: `Below floor (${formatCompactUnits(below, 6)} USDC)`,
          scenario: { observedAmount: formatCompactUnits(below, 6), ...senderOverride },
        },
      );
    } else {
      presets.push({
        id: 'payment-sample',
        label: 'Sample (10 USDC)',
        scenario: { observedAmount: '10', ...senderOverride },
      });
    }
    if (reqs.needsActor && draft.subject.trim()) {
      const altSender =
        draft.subject.trim().toLowerCase() === '0x0000000000000000000000000000000000000001'
          ? '0x0000000000000000000000000000000000000002'
          : '0x0000000000000000000000000000000000000001';
      presets.push({
        id: 'payment-other-sender',
        label: 'Other sender',
        scenario: {
          observedAmount: presets[0]?.scenario.observedAmount ?? '10',
          actor: altSender,
        },
      });
    }
    return presets;
  }

  if (draft.trigger === T.transfer) {
    const first = conditions.find(
      (c) => (c.check === C.amountAtLeast || c.check === C.amountAbove) && c.value > 0n,
    );
    const threshold = first?.value ?? 1_000_000n;
    const above = threshold + 1n;
    const below = threshold > 1n ? threshold - 1n : 0n;
    presets.push(
      {
        id: 'transfer-match',
        label: 'Above threshold',
        scenario: { observedAmount: above.toString() },
      },
      {
        id: 'transfer-skip',
        label: 'Below threshold',
        scenario: { observedAmount: below.toString() },
      },
    );
    return presets;
  }

  if (draft.trigger === T.price) {
    const trailing = conditions.find((c) => c.check === C.trailing && c.value > 0n);
    const stop = conditions.find((c) => c.check === C.priceAtMost && c.value > 0n);
    const aboveRef = conditions.find((c) => c.check === C.aboveReference && c.value > 0n);
    const belowRef = conditions.find((c) => c.check === C.belowReference && c.value > 0n);
    const outside = conditions.find(
      (c) => c.check === C.priceOutside && c.value > 0n && c.upper > 0n,
    );
    const atLeast = conditions.find((c) => c.check === C.priceAtLeast && c.value > 0n);
    const below = conditions.find((c) => c.check === C.priceBelow && c.value > 0n);
    const rises = conditions.find((c) => c.check === C.priceRisesThrough && c.value > 0n);
    const falls = conditions.find((c) => c.check === C.priceFallsThrough && c.value > 0n);

    if (trailing) {
      const high = stop ? stop.value * 2n : parseUnits('3000', 18);
      const dropBps = hitDownBps(trailing.value);
      const dropTrigger = scalePercentDown(high, dropBps);
      const mildPullback = scalePercentDown(high, trailing.value / 2n);
      presets.push({
        id: 'trailing-drop',
        label: `Trail hit (-${formatCompactUnits(dropBps, 2)}%)`,
        scenario: {
          trailingHigh: formatCompactUnits(high, 18),
          price: formatCompactUnits(dropTrigger, 18),
        },
      });
      if (stop) {
        const belowStop =
          stop.value > parseUnits('100', 18) ? stop.value - parseUnits('50', 18) : stop.value;
        presets.push({
          id: 'trailing-stop',
          label: `Hard stop (${formatUsdPrice(belowStop)})`,
          scenario: {
            trailingHigh: formatCompactUnits(high, 18),
            price: formatCompactUnits(belowStop, 18),
          },
        });
      }
      presets.push({
        id: 'trailing-hold',
        label: `Hold (${formatUsdPrice(mildPullback)})`,
        scenario: {
          trailingHigh: formatCompactUnits(high, 18),
          price: formatCompactUnits(mildPullback, 18),
        },
      });
      return presets;
    }

    if (aboveRef || belowRef) {
      const ref = aboveRef?.upper || belowRef?.upper || parseUnits('2000', 18);
      const bandBps = aboveRef?.value || belowRef?.value || 500n;
      const high = scalePercentUp(ref, bandBps + 100n);
      const low = scalePercentDown(ref, hitDownBps(bandBps));
      presets.push(
        {
          id: 'band-sell',
          label: `Above band (${formatUsdPrice(high)})`,
          scenario: {
            referencePrice: formatCompactUnits(ref, 18),
            price: formatCompactUnits(high, 18),
          },
        },
        {
          id: 'band-buy',
          label: `Below band (${formatUsdPrice(low)})`,
          scenario: {
            referencePrice: formatCompactUnits(ref, 18),
            price: formatCompactUnits(low, 18),
          },
        },
        {
          id: 'band-inside',
          label: `Inside band (${formatUsdPrice(ref)})`,
          scenario: {
            referencePrice: formatCompactUnits(ref, 18),
            price: formatCompactUnits(ref, 18),
          },
        },
      );
      return presets;
    }

    if (outside) {
      const low =
        outside.value > parseUnits('100', 18)
          ? outside.value - parseUnits('100', 18)
          : outside.value / 2n;
      const mid = (outside.value + outside.upper) / 2n;
      const high = outside.upper + parseUnits('100', 18);
      presets.push(
        {
          id: 'range-below',
          label: `Below (${formatUsdPrice(low)})`,
          scenario: { price: formatCompactUnits(low, 18) },
        },
        {
          id: 'range-inside',
          label: `Inside (${formatUsdPrice(mid)})`,
          scenario: { price: formatCompactUnits(mid, 18) },
        },
        {
          id: 'range-above',
          label: `Above (${formatUsdPrice(high)})`,
          scenario: { price: formatCompactUnits(high, 18) },
        },
      );
      return presets;
    }

    if (rises || falls) {
      const target = (rises ?? falls)!.value;
      const belowTarget = scalePercentDown(target, 300n);
      const aboveTarget = scalePercentUp(target, 300n);
      if (rises) {
        presets.push(
          {
            id: 'cross-up',
            label: 'Crosses upward',
            scenario: {
              previousPrice: formatCompactUnits(belowTarget, 18),
              price: formatCompactUnits(aboveTarget, 18),
            },
          },
          {
            id: 'no-cross',
            label: 'Stays below',
            scenario: {
              previousPrice: formatCompactUnits(belowTarget, 18),
              price: formatCompactUnits(scalePercentDown(target, 100n), 18),
            },
          },
        );
      } else {
        presets.push(
          {
            id: 'cross-down',
            label: 'Crosses downward',
            scenario: {
              previousPrice: formatCompactUnits(aboveTarget, 18),
              price: formatCompactUnits(belowTarget, 18),
            },
          },
          {
            id: 'no-cross',
            label: 'Stays above',
            scenario: {
              previousPrice: formatCompactUnits(aboveTarget, 18),
              price: formatCompactUnits(scalePercentUp(target, 100n), 18),
            },
          },
        );
      }
      return presets;
    }

    const single = stop ?? atLeast ?? below;
    if (single) {
      const hit =
        single.check === C.priceAtLeast
          ? single.value
          : single.check === C.priceAtMost
            ? single.value
            : scalePercentDown(single.value, 500n);
      const miss =
        single.check === C.priceAtLeast
          ? scalePercentDown(single.value, 500n)
          : scalePercentUp(single.value, 500n);
      presets.push(
        {
          id: 'price-hit',
          label: `Target hit (${formatUsdPrice(hit)})`,
          scenario: { price: formatCompactUnits(hit, 18) },
        },
        {
          id: 'price-miss',
          label: `Not reached (${formatUsdPrice(miss)})`,
          scenario: { price: formatCompactUnits(miss, 18) },
        },
      );
      return presets;
    }

    presets.push({
      id: 'price-sample',
      label: 'Pool at $2,500',
      scenario: { price: '2500' },
    });
    return presets;
  }

  // Schedule trigger
  const dip = conditions.find((c) => c.check === C.dipBy && c.value > 0n);
  const usdcFloor = conditions.find((c) => c.check === C.usdcBelow && c.value > 0n);
  const inactivity = conditions.find((c) => c.check === C.inactivity && c.value > 0n);

  if (dip) {
    const baseline = parseUnits('2500', 18);
    const dipBps = hitDownBps(dip.value);
    const dipped = scalePercentDown(baseline, dipBps);
    presets.push(
      {
        id: 'dip-triggered',
        label: `Dipped (-${formatCompactUnits(dipBps, 2)}%)`,
        scenario: {
          referencePrice: '2500',
          price: formatCompactUnits(dipped, 18),
        },
      },
      {
        id: 'dip-flat',
        label: 'Flat ($2,500)',
        scenario: { referencePrice: '2500', price: '2500' },
      },
      {
        id: 'dip-first-run',
        label: 'First run (no baseline)',
        scenario: { referencePrice: '', price: '2500' },
      },
    );
    return presets;
  }

  if (usdcFloor) {
    const lowBalance = usdcFloor.value / 2n;
    const healthyBalance = usdcFloor.value + parseUnits('5', 6);
    presets.push(
      {
        id: 'refill-needed',
        label: `Low balance (${formatCompactUnits(lowBalance, 6)} USDC)`,
        scenario: { vaultUsdcBalance: formatCompactUnits(lowBalance, 6) },
      },
      {
        id: 'refill-ok',
        label: `Funded (${formatCompactUnits(healthyBalance, 6)} USDC)`,
        scenario: { vaultUsdcBalance: formatCompactUnits(healthyBalance, 6) },
      },
    );
    return presets;
  }

  if (inactivity) {
    presets.push(
      {
        id: 'inactivity-grace',
        label: 'Inactive (starts grace)',
        scenario: {
          inactiveSeconds: inactivity.value.toString(),
          inactivityGraceElapsed: false,
        },
      },
      {
        id: 'inactivity-payout',
        label: 'Grace elapsed (pays)',
        scenario: {
          inactiveSeconds: inactivity.value.toString(),
          inactivityGraceElapsed: true,
        },
      },
      {
        id: 'inactivity-active',
        label: 'Active recently',
        scenario: {
          inactiveSeconds: (inactivity.value / 2n).toString(),
          inactivityGraceElapsed: false,
        },
      },
    );
    return presets;
  }

  return presets;
}
