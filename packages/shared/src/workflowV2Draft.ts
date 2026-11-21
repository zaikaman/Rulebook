import {
  workflowV2Action as A,
  workflowV2Check as C,
  workflowV2Nodes,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type WorkflowV2Branch,
  type WorkflowV2Program,
} from './workflowsV2.js';
import { formatUnits, getAddress, isAddress, zeroAddress, type Address } from 'viem';
import { z } from 'zod';
import { UNICHAIN_SEPOLIA_CHAIN_ID as UNICHAIN } from './chains.js';
import { readAmount } from './workflows.js';

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
  chain: typeof UNICHAIN;
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
export type WeeklyBudgetAmounts = { readonly usdc: bigint; readonly weth: bigint };

export const emptyPath = (): DraftPath => ({ steps: [] });
export const emptyDraft = (): V2Draft => ({
  title: '',
  chain: UNICHAIN,
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
  chain: z.literal(UNICHAIN),
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

/** Older local drafts and Marketplace copies predate weekly budgets; blank means unlimited. */
export const v2DraftSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return { usdcWeeklyBudget: '', wethWeeklyBudget: '', ...(value as Record<string, unknown>) };
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
    chain: p.chain as typeof UNICHAIN,
    trigger,
    interval: p.interval ? String(p.interval) : '',
    expires: p.expires ? p.expires.toString() : '',
    source: p.source === zeroAddress ? '' : p.source,
    subject: p.subject === zeroAddress ? '' : p.subject,
    usdcCap: formatUnits(p.usdcCap, 6),
    wethCap: formatUnits(p.wethCap, 18),
    usdcWeeklyBudget: '',
    wethWeeklyBudget: '',
    slippage: formatUnits(BigInt(p.slippage), 2),
    once: p.once,
    root: branch(0),
  };
}

function amount(value: string, decimals: number, label: string, optional = false) {
  return !value.trim() && optional ? 0n : readAmount(value, decimals, label);
}

function account(value: string, label: string, required = false): Address {
  const address = value.trim();
  if (!address && !required) return zeroAddress;
  if (!isAddress(address, { strict: false }) || address.toLowerCase() === zeroAddress)
    throw new Error(`Enter a valid ${label}.`);
  return getAddress(address);
}

/** Reads one optional weekly limit, rejecting zero, over-precision, and values above uint96. */
export function readWeeklyLimit(value: string, asset: 'USDC' | 'WETH') {
  if (!value.trim()) return 0n;
  const amount = readAmount(value, asset === 'USDC' ? 6 : 18, `${asset} weekly limit`);
  if (amount === 0n) throw new Error(`Enter a positive ${asset} weekly limit or leave it blank.`);
  if (amount > weeklyBudgetCeiling) {
    throw new Error(`The ${asset} weekly limit is above the contract maximum.`);
  }
  return amount;
}

export function weeklyBudgetFromDraft(
  draft: Pick<V2Draft, 'usdcWeeklyBudget' | 'wethWeeklyBudget'>,
): WeeklyBudgetAmounts {
  return {
    usdc: readWeeklyLimit(draft.usdcWeeklyBudget, 'USDC'),
    weth: readWeeklyLimit(draft.wethWeeklyBudget, 'WETH'),
  };
}

export function toProgram(draft: V2Draft): WorkflowV2Program {
  const title = draft.title.trim();
  if (!title || new TextEncoder().encode(title).length > 80)
    throw new Error('Enter a workflow name of up to 80 bytes.');
  function build(path: DraftPath): WorkflowV2Branch {
    if ('steps' in path)
      return {
        actions: path.steps.map((step) => ({
          kind: step.kind,
          unit: step.unit,
          amount: actions[step.kind].asset
            ? amount(step.amount, actionDecimals(step.kind, step.unit), 'step amount')
            : 0n,
          account: actions[step.kind].recipient
            ? account(step.recipient, 'recipient address', true)
            : zeroAddress,
        })),
      };
    return {
      check: path.check,
      value:
        checks[path.check].decimals === undefined
          ? 0n
          : amount(path.value, checkDecimals(path.check, draft.trigger), 'check threshold'),
      upper: checks[path.check].upper
        ? amount(path.upper, 18, 'upper value', path.check !== C.priceOutside)
        : 0n,
      yes: build(path.yes),
      no: build(path.no),
    };
  }
  const nodes = workflowV2Nodes(build(draft.root));
  if (!nodes.some((node) => node.actions.length))
    throw new Error('Add at least one action or notification.');
  const interval =
    draft.trigger === T.schedule ? amount(draft.interval, 0, 'schedule interval') : 0n;
  if (draft.trigger === T.schedule && (interval < 120n || interval > 2_592_000n))
    throw new Error('Set a schedule between 120 seconds and 30 days.');
  const expires = amount(draft.expires, 0, 'expiry', true);
  if (expires && expires <= BigInt(Math.floor(Date.now() / 1_000)))
    throw new Error('Choose a future expiry time.');
  const slippage = amount(draft.slippage, 2, 'slippage', true);
  if (slippage > 1_000n) throw new Error('Swap slippage can be at most 10%.');
  return {
    chain: draft.chain,
    trigger: draft.trigger,
    interval: Number(interval),
    expires,
    source: account(draft.source, 'source token address', draft.trigger === T.transfer),
    subject: account(draft.subject, 'watched wallet address'),
    usdcCap: amount(draft.usdcCap, 6, 'USDC cap', true),
    wethCap: amount(draft.wethCap, 18, 'WETH cap', true),
    slippage: Number(slippage),
    once: draft.once,
    nodes,
  };
}
