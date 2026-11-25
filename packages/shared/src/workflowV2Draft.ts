import {
  workflowV2Action as A,
  workflowV2Check as C,
  workflowV2Nodes,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type WorkflowV2Branch,
  type WorkflowV2Program,
} from './workflowsV2.js';
import { formatUnits, zeroAddress, type Address } from 'viem';
import { z } from 'zod';
import {
  isFundsChain,
  UNICHAIN_SEPOLIA_CHAIN_ID as UNICHAIN,
  type FundsChainId,
} from './chains.js';
import { fundsChainIdSchema } from './schemas.js';
import {
  fieldIssue,
  readField,
  workflowFieldSpecs,
  workflowGuardrailFields,
} from './workflowFields.js';
import { readAddressField, readAmountField, type AmountFieldRules } from './workflowValidation.js';
import { workflowLimits } from './workflows.js';

type Code<T> = T[keyof T];
export type TriggerCode = Code<typeof T>;
export type CheckCode = Code<typeof C>;
export type ActionCode = Code<typeof A>;

export const triggers: Record<TriggerCode, string> = {
  [T.schedule]: 'On a schedule',
  [T.payment]: 'Vault receives USDC',
  [T.price]: 'Pool price changes',
  [T.transfer]: 'Token transfer',
};

export const checks: Record<CheckCode, { name: string; decimals?: number; upper?: string }> = {
  [C.amountAtLeast]: { name: 'Amount is at least', decimals: 0 },
  [C.amountAbove]: { name: 'Amount is above', decimals: 0 },
  [C.priceAtLeast]: { name: 'Price is at least', decimals: 18 },
  [C.priceAtMost]: { name: 'Price is at most', decimals: 18 },
  [C.priceBelow]: { name: 'Price is below', decimals: 18 },
  [C.priceOutside]: {
    name: 'Price is outside a range',
    decimals: 18,
    upper: 'Upper price in USDC per WETH',
  },
  [C.dipBy]: { name: 'Price dipped by (%)', decimals: 2 },
  [C.trailing]: { name: 'Price fell from its high (%)', decimals: 2 },
  [C.aboveReference]: {
    name: 'Price rose from its reference (%)',
    decimals: 2,
    upper: 'Starting reference price',
  },
  [C.belowReference]: {
    name: 'Price fell from its reference (%)',
    decimals: 2,
    upper: 'Starting reference price',
  },
  [C.usdcBelow]: { name: 'Vault USDC is below', decimals: 6 },
  [C.inactivity]: { name: 'Wallet was inactive for (seconds)', decimals: 0 },
  [C.priceRisesThrough]: { name: 'Price rises through target', decimals: 18 },
  [C.priceFallsThrough]: { name: 'Price falls through target', decimals: 18 },
  [C.paymentFrom]: { name: 'Payment is from the specified wallet' },
};

export const actions: Record<
  ActionCode,
  { name: string; asset?: 'USDC' | 'WETH' | 'ETH'; recipient?: boolean }
> = {
  [A.send]: { name: 'Send USDC', asset: 'USDC', recipient: true },
  [A.buy]: { name: 'Buy WETH with USDC', asset: 'USDC' },
  [A.sell]: { name: 'Sell WETH for USDC', asset: 'WETH' },
  [A.refill]: { name: 'Refill Vault USDC', asset: 'USDC' },
  [A.alert]: { name: 'Record an alert' },
  [A.inactivityPayout]: { name: 'Send inactivity payout', asset: 'USDC', recipient: true },
};

export type DraftStep = {
  kind: ActionCode;
  unit: Code<typeof U>;
  amount: string;
  recipient: string;
};
export type DraftPath =
  | { steps: DraftStep[] }
  | { check: CheckCode; value: string; upper: string; yes: DraftPath; no: DraftPath };
export type V2Draft = {
  title: string;
  chain: FundsChainId;
  originChain: FundsChainId;
  trigger: TriggerCode;
  interval: string;
  expires: string;
  source: string;
  subject: string;
  usdcCap: string;
  wethCap: string;
  usdcWeeklyBudget: string;
  wethWeeklyBudget: string;
  slippage: string;
  once: boolean;
  root: DraftPath;
};

export const weeklyBudgetCeiling = (1n << 96n) - 1n;
const maxAmount = weeklyBudgetCeiling;
const maxThreshold = (1n << 128n) - 1n;
const bps = 10_000n;
const minInactivitySeconds = 86_400n;
const minScheduleInterval = 120;
const maxScheduleInterval = 2_592_000;
export type WeeklyBudgetAmounts = { readonly usdc: bigint; readonly weth: bigint };

/** The assets a draft can spend in one run. A percent step spends USDC. */
export interface DraftSpending {
  readonly usdc: boolean;
  readonly weth: boolean;
}

export function draftSpending(draft: Pick<V2Draft, 'root'>): DraftSpending {
  let usdc = false;
  let weth = false;
  function visit(path: DraftPath) {
    if ('steps' in path) {
      for (const step of path.steps) {
        const asset = actions[step.kind].asset;
        if (asset === 'USDC') usdc = true;
        if (asset === 'WETH') weth = true;
      }
      return;
    }
    visit(path.yes);
    visit(path.no);
  }
  visit(draft.root);
  return { usdc, weth };
}

/** True when any leaf in the draft executes a buy or sell swap. */
export function draftHasSwap(draft: Pick<V2Draft, 'root'>): boolean {
  function visit(path: DraftPath): boolean {
    if ('steps' in path)
      return path.steps.some((step) => step.kind === A.buy || step.kind === A.sell);
    return visit(path.yes) || visit(path.no);
  }
  return visit(draft.root);
}

/** True when any condition in the draft uses the specified check code. */
export function draftHasCheck(draft: Pick<V2Draft, 'root'>, check: CheckCode): boolean {
  function visit(path: DraftPath): boolean {
    if ('steps' in path) return false;
    return path.check === check || visit(path.yes) || visit(path.no);
  }
  return visit(draft.root);
}

/** True when any leaf in the draft contains the specified action code. */
export function draftHasAction(draft: Pick<V2Draft, 'root'>, kind: ActionCode): boolean {
  function visit(path: DraftPath): boolean {
    if ('steps' in path) return path.steps.some((step) => step.kind === kind);
    return visit(path.yes) || visit(path.no);
  }
  return visit(draft.root);
}

/**
 * Field error for a per-run cap. Blank is valid only when the workflow cannot spend that asset,
 * because the contract reads a stored zero cap as "this run may spend nothing".
 */
export function capIssue(asset: 'USDC' | 'WETH', value: string, needed: boolean) {
  const issue = fieldIssue(
    asset === 'USDC' ? workflowGuardrailFields.usdcCap : workflowGuardrailFields.wethCap,
    value,
  );
  if (issue) return issue;
  if (!needed || value.trim()) return undefined;
  return asset === 'USDC'
    ? 'Enter a per-run USDC cap because this workflow spends USDC.'
    : 'Enter a per-run WETH cap because this workflow sells WETH.';
}

/**
 * Field error for swap slippage. Blank is valid only when the workflow has no buy or sell steps,
 * because the contract rejects swaps when `program.slippage == 0`.
 */
export function slippageIssue(value: string, needed: boolean) {
  const issue = fieldIssue(workflowGuardrailFields.slippage, value);
  if (issue) return issue;
  if (!needed || value.trim()) return undefined;
  return 'Enter a maximum swap slippage because this workflow buys or sells WETH.';
}

export const emptyPath = (): DraftPath => ({ steps: [] });
export const emptyDraft = (chain: FundsChainId = UNICHAIN): V2Draft => ({
  title: '',
  chain,
  originChain: chain,
  trigger: T.schedule,
  interval: '',
  expires: '',
  source: '',
  subject: '',
  usdcCap: '',
  wethCap: '',
  usdcWeeklyBudget: '',
  wethWeeklyBudget: '',
  slippage: '',
  once: false,
  root: emptyPath(),
});

function code<T extends number>(values: readonly T[]) {
  return z.custom<T>((value) => values.some((candidate) => candidate === value));
}

const pathSchema: z.ZodType<DraftPath> = z.lazy(() =>
  z.union([
    z.object({
      steps: z
        .array(
          z.object({
            kind: code(Object.values(A)),
            unit: code(Object.values(U)),
            amount: z.string(),
            recipient: z.string(),
          }),
        )
        .max(3),
    }),
    z.object({
      check: code(Object.values(C)),
      value: z.string(),
      upper: z.string(),
      yes: pathSchema,
      no: pathSchema,
    }),
  ]),
);

const draftObject = z.object({
  title: z.string(),
  chain: fundsChainIdSchema,
  originChain: fundsChainIdSchema,
  trigger: code(Object.values(T)),
  interval: z.string(),
  expires: z.string(),
  source: z.string(),
  subject: z.string(),
  usdcCap: z.string(),
  wethCap: z.string(),
  usdcWeeklyBudget: z.string(),
  wethWeeklyBudget: z.string(),
  slippage: z.string(),
  once: z.boolean(),
  root: pathSchema,
});

/** Older local drafts and Marketplace copies predate weekly budgets and originChain. */
export const v2DraftSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    usdcWeeklyBudget: '',
    wethWeeklyBudget: '',
    originChain: record.chain ?? UNICHAIN,
    ...record,
  };
}, draftObject);

export function actionDecimals(kind: ActionCode, unit: DraftStep['unit']) {
  if (unit === U.percent) return 2;
  return actions[kind].asset === 'USDC' ? 6 : 18;
}

export function checkDecimals(kind: CheckCode, trigger: TriggerCode) {
  if ((kind === C.amountAtLeast || kind === C.amountAbove) && trigger === T.payment) return 6;
  return checks[kind].decimals ?? 0;
}

export function toDraft(p: WorkflowV2Program, title: string): V2Draft {
  const trigger = p.trigger as TriggerCode;
  function branch(index: number): DraftPath {
    const node = p.nodes[index];
    if (!node) throw new Error('The workflow contains an invalid path.');
    if (!node.check)
      return {
        steps: node.actions.map((step) => ({
          kind: step.kind as ActionCode,
          unit: step.unit as DraftStep['unit'],
          amount: step.amount
            ? formatUnits(
                step.amount,
                actionDecimals(step.kind as ActionCode, step.unit as DraftStep['unit']),
              )
            : '',
          recipient: step.account === zeroAddress ? '' : step.account,
        })),
      };
    const check = node.check as CheckCode;
    return {
      check,
      value: node.value ? formatUnits(node.value, checkDecimals(check, trigger)) : '',
      upper: node.upper ? formatUnits(node.upper, 18) : '',
      yes: branch(node.yes),
      no: branch(node.no),
    };
  }
  return {
    title,
    chain: p.chain as FundsChainId,
    originChain: p.originChain as FundsChainId,
    trigger,
    interval: p.interval ? String(p.interval) : '',
    expires: p.expires ? p.expires.toString() : '',
    source: p.source === zeroAddress ? '' : p.source,
    subject: p.subject === zeroAddress ? '' : p.subject,
    usdcCap: p.usdcCap === 0n ? '' : formatUnits(p.usdcCap, 6),
    wethCap: p.wethCap === 0n ? '' : formatUnits(p.wethCap, 18),
    usdcWeeklyBudget: '',
    wethWeeklyBudget: '',
    slippage: p.slippage === 0 ? '' : formatUnits(BigInt(p.slippage), 2),
    once: p.once,
    root: branch(0),
  };
}

/**
 * Builds an editable draft from a published program. A copy keeps the trigger, checks, amounts,
 * per-run caps, watched wallet, and expiry so it reproduces the listed program. Recipients are
 * cleared because they receive the copier's funds and must be chosen by the copier.
 */
export function toCopyDraft(program: WorkflowV2Program, title: string): V2Draft {
  const draft = toDraft(program, title);
  function clearRecipients(path: DraftPath): DraftPath {
    if ('steps' in path) return { steps: path.steps.map((step) => ({ ...step, recipient: '' })) };
    return { ...path, yes: clearRecipients(path.yes), no: clearRecipients(path.no) };
  }
  return { ...draft, root: clearRecipients(draft.root) };
}

const percentChecks = new Set<CheckCode>([C.dipBy, C.trailing, C.aboveReference, C.belowReference]);
const validTriggers = new Set<number>(Object.values(T));
const validChecks = new Set<number>(Object.values(C));
const validActions = new Set<number>(Object.values(A));
const priceOnlyChecks = new Set<number>([
  C.priceRisesThrough,
  C.priceFallsThrough,
  C.trailing,
  C.aboveReference,
  C.belowReference,
]);
const amountChecks = new Set<number>([C.amountAtLeast, C.amountAbove]);

export function checkThresholdRules(check: CheckCode, trigger: TriggerCode): AmountFieldRules {
  const decimals = checkDecimals(check, trigger);
  if (check === C.inactivity) {
    return {
      subject: 'The condition threshold',
      noun: 'an inactivity window',
      decimals,
      unit: 'seconds',
      minimum: minInactivitySeconds,
      maximum: maxThreshold,
      minimumText: '24 hours (86,400 seconds)',
      maximumText: 'the contract maximum',
    };
  }
  if (percentChecks.has(check)) {
    return {
      subject: 'The condition threshold',
      noun: 'a percentage threshold',
      decimals,
      unit: '%',
      minimum: 1n,
      maximum: bps - 1n,
    };
  }
  return {
    subject: 'The condition threshold',
    noun: 'a threshold',
    decimals,
    minimum: 1n,
    maximum: maxThreshold,
    maximumText: 'the contract maximum',
  };
}

export function checkUpperRules(check: CheckCode): AmountFieldRules {
  return {
    subject: 'The upper value',
    noun: 'an upper value',
    decimals: 18,
    minimum: check === C.priceOutside ? 1n : undefined,
    maximum: maxThreshold,
    maximumText: 'the contract maximum',
    optional: check !== C.priceOutside,
  };
}

export function stepAmountRules(kind: ActionCode, unit: DraftStep['unit']): AmountFieldRules {
  const percent = unit === U.percent;
  const asset = actions[kind].asset;
  return {
    subject: 'The step amount',
    noun: 'a step amount',
    decimals: actionDecimals(kind, unit),
    unit: percent ? '%' : asset,
    minimum: 1n,
    maximum: percent ? bps : maxAmount,
    maximumText: percent ? undefined : 'the contract maximum',
  };
}

function account(value: string, noun: string, required = false): Address {
  return readAddressField(value, { noun, optional: !required });
}

/** Reads one optional weekly limit, rejecting zero, over-precision, and values above uint96. */
export function readWeeklyLimit(value: string, asset: 'USDC' | 'WETH') {
  return readAmountField(value, {
    subject: `The weekly ${asset} budget`,
    noun: `a ${asset} weekly budget`,
    decimals: asset === 'USDC' ? 6 : 18,
    unit: asset,
    minimum: 1n,
    maximum: weeklyBudgetCeiling,
    maximumText: 'the contract maximum',
    optional: true,
  });
}

export function weeklyBudgetFromDraft(
  draft: Pick<V2Draft, 'usdcWeeklyBudget' | 'wethWeeklyBudget'>,
): WeeklyBudgetAmounts {
  return {
    usdc: readWeeklyLimit(draft.usdcWeeklyBudget, 'USDC'),
    weth: readWeeklyLimit(draft.wethWeeklyBudget, 'WETH'),
  };
}

function capAmount(value: bigint, decimals: number, asset: string) {
  const [whole, fraction] = formatUnits(value, decimals).split('.');
  const trimmed = fraction?.replace(/0+$/, '');
  return `${whole}${trimmed ? `.${trimmed}` : ''} ${asset}`;
}

/** Rejects a program whose per-run caps cannot cover its own paths. */
function checkCaps(nodes: WorkflowV2Program['nodes'], usdcCap: bigint, wethCap: bigint) {
  let usdc = 0n;
  let weth = 0n;
  let percent = false;
  for (const node of nodes) {
    if (node.check !== 0) continue;
    let pathUsdc = 0n;
    let pathWeth = 0n;
    for (const step of node.actions) {
      if (step.kind === A.alert) continue;
      if (step.unit === U.percent) {
        percent = true;
        continue;
      }
      if (step.kind === A.sell) pathWeth += step.amount;
      else pathUsdc += step.amount;
    }
    if (pathUsdc > usdc) usdc = pathUsdc;
    if (pathWeth > weth) weth = pathWeth;
  }
  if (usdcCap === 0n && (usdc > 0n || percent)) {
    throw new Error(
      usdc > 0n
        ? 'Enter a per-run USDC cap because this workflow spends USDC.'
        : 'Enter a per-run USDC cap because this workflow spends a share of the incoming payment.',
    );
  }
  if (weth > 0n && wethCap === 0n)
    throw new Error('Enter a per-run WETH cap because this workflow sells WETH.');
  if (usdc > usdcCap)
    throw new Error(
      `The per-run USDC cap is ${capAmount(usdcCap, 6, 'USDC')}, but one run can spend ${capAmount(usdc, 6, 'USDC')}. Raise the cap or lower the spend.`,
    );
  if (weth > wethCap)
    throw new Error(
      `The per-run WETH cap is ${capAmount(wethCap, 18, 'WETH')}, but one run can sell ${capAmount(weth, 18, 'WETH')}. Raise the cap or lower the sale.`,
    );
}

function validateConditionNode(
  program: WorkflowV2Program,
  node: WorkflowV2Program['nodes'][number],
) {
  const check = node.check;
  if (!validChecks.has(check)) throw new Error('Select a supported condition.');
  const checkName = checks[check as CheckCode].name;
  if (check === C.paymentFrom) {
    if (node.value !== 0n) throw new Error(`${checkName} does not use a threshold.`);
    if (program.trigger !== T.payment) {
      throw new Error(`${checkName} requires the Vault receives USDC trigger.`);
    }
    if (program.subject === zeroAddress) {
      throw new Error(`Enter a watched wallet address for the ${checkName} check.`);
    }
  } else if (node.value <= 0n || node.value > maxThreshold) {
    throw new Error(`Enter a valid threshold for ${checkName}.`);
  }

  if (check === C.priceOutside) {
    if (node.upper <= node.value || node.upper > maxThreshold) {
      throw new Error('Set an upper price above the lower price.');
    }
  } else if (node.upper !== 0n && check !== C.aboveReference && check !== C.belowReference) {
    throw new Error('Only range and reference checks support an upper price.');
  } else if (node.upper > maxThreshold) {
    throw new Error('The upper price exceeds the contract maximum.');
  }

  if (amountChecks.has(check) && program.trigger !== T.payment && program.trigger !== T.transfer) {
    throw new Error(`${checkName} requires a payment or transfer trigger.`);
  }
  if (percentChecks.has(check as CheckCode) && node.value >= bps) {
    throw new Error(`${checkName} must be below 100%.`);
  }
  if (priceOnlyChecks.has(check) && program.trigger !== T.price) {
    throw new Error(`${checkName} requires the pool price trigger.`);
  }
  if (check === C.dipBy && program.trigger !== T.schedule) {
    throw new Error(`${checkName} requires a schedule trigger.`);
  }
  if (check === C.inactivity) {
    if (program.trigger !== T.schedule) {
      throw new Error(`${checkName} requires a schedule trigger.`);
    }
    if (node.value < minInactivitySeconds) {
      throw new Error('The inactivity window must be at least 24 hours (86,400 seconds).');
    }
  }
}

function validateLeafActions(
  program: WorkflowV2Program,
  leafActions: WorkflowV2Program['nodes'][number]['actions'],
  activeChecks: ReadonlySet<number>,
  skipCaps = false,
) {
  if (leafActions.length > workflowLimits.stepsPerPath) {
    throw new Error('A workflow path can have up to three actions.');
  }
  let usdc = 0n;
  let weth = 0n;
  let percent = 0n;
  let swap = false;

  for (const step of leafActions) {
    const kind = step.kind;
    if (!validActions.has(kind)) throw new Error('Select a supported action.');
    if (kind === A.alert) {
      if (step.amount !== 0n || step.unit !== U.fixed || step.account !== zeroAddress) {
        throw new Error('Alerts cannot have an amount, percent unit, or recipient.');
      }
      continue;
    }

    if (step.amount <= 0n || step.amount > maxAmount) {
      throw new Error(
        'Each step amount must be greater than zero and within the contract maximum.',
      );
    }
    if (step.unit !== U.fixed && step.unit !== U.percent) {
      throw new Error('Select a supported amount unit.');
    }
    if (step.unit === U.percent) {
      if (program.trigger !== T.payment) {
        throw new Error('Percent of payment amounts require the Vault receives USDC trigger.');
      }
      if (kind !== A.send && kind !== A.buy) {
        throw new Error(
          'Percent of payment amounts are only supported for Send USDC and Buy WETH with USDC.',
        );
      }
    }
    if (kind === A.buy || kind === A.sell) {
      if (swap) {
        throw new Error('A single path can include at most one buy or sell action.');
      }
      if (program.slippage === 0) {
        throw new Error('Enter a maximum swap slippage because this workflow buys or sells WETH.');
      }
      swap = true;
    }
    if (kind === A.send || kind === A.inactivityPayout) {
      if (step.account === zeroAddress) throw new Error('Enter a recipient address.');
    } else if (step.account !== zeroAddress) {
      throw new Error('Only transfer and inactivity payout actions can specify a recipient.');
    }
    if (kind === A.refill && !activeChecks.has(C.usdcBelow)) {
      throw new Error(
        'Refill Vault USDC must be inside the Yes branch of a Vault USDC is below check.',
      );
    }
    if (kind === A.inactivityPayout) {
      if (!activeChecks.has(C.inactivity)) {
        throw new Error(
          'Send inactivity payout must be inside the Yes branch of a Wallet was inactive for check.',
        );
      }
      if (leafActions.length !== 1) {
        throw new Error(
          'Send inactivity payout cannot be combined with other actions on the same path.',
        );
      }
      if (!program.once) {
        throw new Error('Enable "Close after a confirmed run" for an inactivity payout.');
      }
    } else if (activeChecks.has(C.inactivity)) {
      throw new Error(
        'Only a single inactivity payout can run inside the Yes branch of a Wallet was inactive for check.',
      );
    }

    if (step.unit === U.percent) percent += step.amount;
    else if (kind === A.sell) weth += step.amount;
    else usdc += step.amount;
  }

  if (percent > bps) {
    throw new Error('A single path can spend at most 100% of an incoming payment.');
  }
  if (skipCaps) return;
  if (usdc > program.usdcCap) {
    throw new Error('The per-run USDC cap is below the spend of one path.');
  }
  if (weth > program.wethCap) {
    throw new Error('The per-run WETH cap is below the sale of one path.');
  }
  if (percent > 0n && program.usdcCap === 0n) {
    throw new Error(
      'Enter a per-run USDC cap because this workflow spends a share of the incoming payment.',
    );
  }
}

/**
 * Mirrors `WorkflowProgramV2.validate` in TypeScript so invalid programs fail with a specific,
 * actionable rule before any RPC call or signature.
 */
export function validateWorkflowV2Program(
  program: WorkflowV2Program,
  options?: { skipCaps?: boolean },
): void {
  if (!isFundsChain(program.chain) || !isFundsChain(program.originChain))
    throw new Error('Select a supported workflow testnet.');
  if (!validTriggers.has(program.trigger)) throw new Error('Select a supported trigger.');
  if (program.slippage < 0 || program.slippage > 1_000) {
    throw new Error('The maximum slippage must be between 0.01% and 10%.');
  }
  if (program.trigger === T.schedule) {
    if (program.interval < minScheduleInterval || program.interval > maxScheduleInterval) {
      throw new Error(
        'The interval must be between 2 minutes (120 seconds) and 30 days (2,592,000 seconds).',
      );
    }
  } else if (program.interval !== 0) {
    throw new Error('Only scheduled workflows can have an interval.');
  }
  if (program.trigger === T.payment && program.originChain !== program.chain) {
    throw new Error('Vault receives USDC must watch the same network as its settlement Vault.');
  }
  if (program.trigger === T.transfer) {
    if (program.source === zeroAddress) {
      throw new Error('Enter a source token address.');
    }
    if (program.originChain !== program.chain && program.subject === zeroAddress) {
      throw new Error(
        'Enter a watched wallet address when watching a token transfer on another network.',
      );
    }
  }

  const count = program.nodes.length;
  if (count === 0 || count > workflowLimits.nodes) {
    throw new Error(`A workflow can have between 1 and ${workflowLimits.nodes} nodes.`);
  }

  const depth = new Array<number>(count).fill(0);
  const pathChecks: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  depth[0] = 1;
  let executable = false;
  let hasPayout = false;

  for (let index = 0; index < count; index += 1) {
    const currentDepth = depth[index]!;
    if (currentDepth === 0) throw new Error('A workflow path is disconnected.');
    const node = program.nodes[index]!;
    const active = pathChecks[index]!;

    if (node.check === 0) {
      if (node.yes !== 0 || node.no !== 0 || node.value !== 0n || node.upper !== 0n) {
        throw new Error('A workflow action path contains invalid branch data.');
      }
      validateLeafActions(program, node.actions, active, options?.skipCaps);
      if (node.actions.length === 1 && node.actions[0]!.kind === A.inactivityPayout) {
        if (hasPayout) {
          throw new Error('A workflow can include at most one inactivity payout.');
        }
        hasPayout = true;
      }
      executable = executable || node.actions.length > 0;
    } else {
      if (
        node.actions.length > 0 ||
        currentDepth > workflowLimits.conditionDepth ||
        node.yes <= index ||
        node.no <= index ||
        node.yes >= count ||
        node.no >= count ||
        node.yes === node.no ||
        depth[node.yes] !== 0 ||
        depth[node.no] !== 0
      ) {
        throw new Error('A workflow condition path is invalid or exceeds the maximum depth.');
      }
      validateConditionNode(program, node);
      depth[node.yes] = currentDepth + 1;
      depth[node.no] = currentDepth + 1;
      pathChecks[node.yes] = new Set([...active, node.check]);
      pathChecks[node.no] = new Set(active);
    }
  }

  if (!executable) throw new Error('Add at least one action or notification.');
  if (
    program.trigger === T.schedule &&
    program.originChain !== program.chain &&
    !program.nodes.some((node) => node.check === C.dipBy)
  ) {
    throw new Error('Cross-chain schedules are only supported with a Price dipped by check.');
  }
}

export function toProgram(draft: V2Draft): WorkflowV2Program {
  const title = draft.title.trim();
  if (!title || new TextEncoder().encode(title).length > 80)
    throw new Error('Enter a workflow name of up to 80 bytes.');
  let hasPaymentFrom = false;
  function build(path: DraftPath): WorkflowV2Branch {
    if ('steps' in path)
      return {
        actions: path.steps.map((step) => {
          if (step.kind === A.alert && step.unit !== U.fixed) {
            throw new Error('Alerts cannot have an amount, percent unit, or recipient.');
          }
          return {
            kind: step.kind,
            unit: step.unit,
            amount: actions[step.kind].asset
              ? readAmountField(step.amount, stepAmountRules(step.kind, step.unit))
              : 0n,
            account: actions[step.kind].recipient
              ? account(step.recipient, 'a recipient address', true)
              : zeroAddress,
          };
        }),
      };
    if (path.check === C.paymentFrom) hasPaymentFrom = true;
    const value =
      checks[path.check].decimals === undefined
        ? 0n
        : readAmountField(path.value, checkThresholdRules(path.check, draft.trigger));
    const upper = checks[path.check].upper
      ? readAmountField(path.upper, checkUpperRules(path.check))
      : 0n;
    if (path.check === C.priceOutside && upper <= value) {
      throw new Error('Set an upper price above the lower price.');
    }
    return {
      check: path.check,
      value,
      upper,
      yes: build(path.yes),
      no: build(path.no),
    };
  }
  const nodes = workflowV2Nodes(build(draft.root));
  if (!nodes.some((node) => node.actions.length))
    throw new Error('Add at least one action or notification.');
  const interval =
    draft.trigger === T.schedule
      ? readField(workflowFieldSpecs.intervalSeconds, draft.interval)
      : 0n;
  const usdcCap = readField(workflowGuardrailFields.usdcCap, draft.usdcCap);
  const wethCap = readField(workflowGuardrailFields.wethCap, draft.wethCap);
  const program: WorkflowV2Program = {
    chain: draft.chain,
    originChain: draft.originChain,
    trigger: draft.trigger,
    interval: Number(interval),
    expires: readField(workflowGuardrailFields.expires, draft.expires),
    source:
      draft.trigger === T.transfer
        ? account(draft.source, 'a source token address', true)
        : zeroAddress,
    subject: account(
      draft.subject,
      'a watched wallet address',
      hasPaymentFrom && draft.trigger === T.payment,
    ),
    usdcCap,
    wethCap,
    slippage: Number(readField(workflowGuardrailFields.slippage, draft.slippage)),
    once: draft.once,
    nodes,
  };
  validateWorkflowV2Program(program, { skipCaps: true });
  checkCaps(nodes, usdcCap, wethCap);
  return program;
}
