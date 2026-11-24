import {
  addressIssue,
  amountIssue,
  readAddressField,
  readAmountField,
  type AmountFieldRules,
  type AddressFieldRules,
} from './workflowValidation.js';
import type { WorkflowV2RecipeId } from './workflowV2Recipes.js';
import type { Address } from 'viem';

const maxAmount = (1n << 96n) - 1n;
const maxThreshold = (1n << 128n) - 1n;

export type NumberFieldSpec = AmountFieldRules & {
  readonly kind: 'number';
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
};

export type AddressFieldSpec = AddressFieldRules & {
  readonly kind: 'address';
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
};

export type DirectionFieldSpec = {
  readonly kind: 'direction';
  readonly label: string;
  readonly hint?: string;
};

export type WorkflowFieldSpec = NumberFieldSpec | AddressFieldSpec | DirectionFieldSpec;

/**
 * One definition per recipe input. The recipe builder and the configurator both read these, so a
 * field hint can never disagree with the constraint that produces the error.
 */
export const workflowFieldSpecs = {
  intervalSeconds: {
    kind: 'number',
    label: 'Interval in seconds',
    subject: 'The interval',
    noun: 'an interval',
    unit: 'seconds',
    decimals: 0,
    minimum: 120n,
    maximum: 2_592_000n,
    minimumText: '2 minutes (120 seconds)',
    maximumText: '30 days (2,592,000 seconds)',
    hint: 'At least 2 minutes and at most 30 days.',
    placeholder: '3600',
  },
  expiresAt: {
    kind: 'number',
    label: 'Expires at (Unix seconds)',
    subject: 'The expiry',
    noun: 'an expiry time',
    decimals: 0,
    future: true,
    hint: 'A Unix timestamp in the future.',
    placeholder: String(Math.floor(Date.now() / 1_000) + 86_400),
  },
  buyUsdc: {
    kind: 'number',
    label: 'USDC to spend',
    subject: 'The USDC amount',
    noun: 'a USDC amount',
    unit: 'USDC',
    decimals: 6,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    hint: 'Taken from your vault on each run.',
    placeholder: '1',
  },
  sellWeth: {
    kind: 'number',
    label: 'WETH to sell',
    subject: 'The WETH amount',
    noun: 'a WETH amount',
    unit: 'WETH',
    decimals: 18,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    hint: 'Held by your vault when the workflow runs.',
    placeholder: '0.001',
  },
  slippagePercent: {
    kind: 'number',
    label: 'Maximum slippage (%)',
    subject: 'The maximum slippage',
    noun: 'a slippage percentage',
    unit: '%',
    decimals: 2,
    minimum: 1n,
    maximum: 1_000n,
    hint: 'At least 0.01% and at most 10%.',
    placeholder: '1',
  },
  dipPercent: {
    kind: 'number',
    label: 'Dip from previous price (%)',
    subject: 'The dip percentage',
    noun: 'a dip percentage',
    unit: '%',
    decimals: 2,
    minimum: 1n,
    maximum: 9_999n,
    hint: 'At least 0.01% and at most 99.99%.',
    placeholder: '5',
  },
  limitPrice: {
    kind: 'number',
    label: 'Limit price (USDC per WETH)',
    subject: 'The limit price',
    noun: 'a limit price',
    unit: 'USDC per WETH',
    decimals: 18,
    minimum: 1n,
    maximum: maxThreshold,
    range: 'greater than zero',
    hint: 'The pool must reach this price before the buy runs.',
    placeholder: '1500',
  },
  targetPrice: {
    kind: 'number',
    label: 'Target price (USDC per WETH)',
    subject: 'The target price',
    noun: 'a target price',
    unit: 'USDC per WETH',
    decimals: 18,
    minimum: 1n,
    maximum: maxThreshold,
    range: 'greater than zero',
    hint: 'The pool price that triggers this workflow.',
    placeholder: '2500',
  },
  stopPrice: {
    kind: 'number',
    label: 'Stop price (USDC per WETH)',
    subject: 'The stop price',
    noun: 'a stop price',
    unit: 'USDC per WETH',
    decimals: 18,
    minimum: 1n,
    maximum: maxThreshold,
    range: 'greater than zero',
    hint: 'The price where the stop starts protecting the position.',
    placeholder: '1250',
  },
  trailPercent: {
    kind: 'number',
    label: 'Trail from high price (%)',
    subject: 'The trail percentage',
    noun: 'a trail percentage',
    unit: '%',
    decimals: 2,
    minimum: 1n,
    maximum: 9_999n,
    hint: 'At least 0.01% and at most 99.99%.',
    placeholder: '8',
  },
  bandPercent: {
    kind: 'number',
    label: 'Band width (%)',
    subject: 'The band width',
    noun: 'a band width',
    unit: '%',
    decimals: 2,
    minimum: 1n,
    maximum: 9_999n,
    hint: 'At least 0.01% and at most 99.99%.',
    placeholder: '5',
  },
  referencePrice: {
    kind: 'number',
    label: 'Starting reference price (USDC per WETH)',
    subject: 'The reference price',
    noun: 'a reference price',
    unit: 'USDC per WETH',
    decimals: 18,
    minimum: 1n,
    maximum: maxThreshold,
    range: 'greater than zero',
    hint: 'The middle of the band when the workflow starts.',
    placeholder: '2000',
  },
  recipient: {
    kind: 'address',
    label: 'Recipient address',
    noun: 'a recipient address',
    hint: 'A wallet on Unichain Sepolia other than your vault.',
    placeholder: '0x…',
  },
  sendUsdc: {
    kind: 'number',
    label: 'USDC to send',
    subject: 'The USDC amount',
    noun: 'a USDC amount',
    unit: 'USDC',
    decimals: 6,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    hint: 'Taken from your vault for each transfer.',
    placeholder: '0.02',
  },
  minimumPaymentUsdc: {
    kind: 'number',
    label: 'Minimum payment (USDC)',
    subject: 'The minimum payment',
    noun: 'a minimum payment',
    unit: 'USDC',
    decimals: 6,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    hint: 'The smallest incoming payment that can trigger a sweep.',
    placeholder: '15',
  },
  smallPaymentUsdc: {
    kind: 'number',
    label: 'Smaller payment threshold (USDC, optional)',
    subject: 'The smaller payment threshold',
    noun: 'a smaller payment threshold',
    unit: 'USDC',
    decimals: 6,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    optional: true,
    hint: 'Optional second tier. Set it together with the smaller sweep.',
    placeholder: '5',
  },
  smallSweepUsdc: {
    kind: 'number',
    label: 'Smaller sweep amount (USDC, optional)',
    subject: 'The smaller sweep amount',
    noun: 'a smaller sweep amount',
    unit: 'USDC',
    decimals: 6,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    optional: true,
    hint: 'Must be below the main sweep and at most the smaller threshold.',
    placeholder: '1',
  },
  floorUsdc: {
    kind: 'number',
    label: 'Balance floor (USDC)',
    subject: 'The balance floor',
    noun: 'a balance floor',
    unit: 'USDC',
    decimals: 6,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    hint: 'Refill when the vault balance drops below this amount.',
    placeholder: '4',
  },
  refillUsdc: {
    kind: 'number',
    label: 'Maximum refill (USDC)',
    subject: 'The refill amount',
    noun: 'a refill amount',
    unit: 'USDC',
    decimals: 6,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    hint: 'Pulled from your wallet when the floor is reached.',
    placeholder: '2',
  },
  inactivitySeconds: {
    kind: 'number',
    label: 'Time without activity (seconds)',
    subject: 'The inactivity window',
    noun: 'an inactivity window',
    unit: 'seconds',
    decimals: 0,
    minimum: 86_400n,
    maximum: maxThreshold,
    minimumText: '24 hours (86,400 seconds)',
    maximumText: 'the contract maximum',
    hint: 'At least 24 hours.',
    placeholder: '604800',
  },
  lowerPrice: {
    kind: 'number',
    label: 'Lower price (USDC per WETH)',
    subject: 'The lower price',
    noun: 'a lower price',
    unit: 'USDC per WETH',
    decimals: 18,
    minimum: 1n,
    maximum: maxThreshold,
    range: 'greater than zero',
    hint: 'The bottom of the watched range.',
    placeholder: '1000',
  },
  upperPrice: {
    kind: 'number',
    label: 'Upper price (USDC per WETH)',
    subject: 'The upper price',
    noun: 'an upper price',
    unit: 'USDC per WETH',
    decimals: 18,
    minimum: 1n,
    maximum: maxThreshold,
    range: 'greater than zero',
    hint: 'The top of the watched range. It must be above the lower price.',
    placeholder: '3000',
  },
  token: {
    kind: 'address',
    label: 'Token contract address',
    noun: 'a token contract address',
    hint: 'The token contract to watch on Unichain Sepolia.',
    placeholder: '0x…',
  },
  watchedWallet: {
    kind: 'address',
    label: 'Watched wallet address',
    noun: 'a watched wallet address',
    hint: 'Transfers from or to this wallet above the threshold record an alert.',
    placeholder: '0x…',
  },
  minimumTransferRaw: {
    kind: 'number',
    label: 'Transfer threshold in token base units',
    subject: 'The transfer threshold',
    noun: 'a transfer threshold',
    decimals: 0,
    minimum: 1n,
    maximum: maxThreshold,
    hint: 'The smallest transfer that records an alert, in the token base units.',
    placeholder: '1000000',
  },
  direction: {
    kind: 'direction',
    label: 'Alert when the price is',
    hint: 'Choose which side of the target price records the alert.',
  },
} as const satisfies Record<string, WorkflowFieldSpec>;

export type WorkflowFieldName = keyof typeof workflowFieldSpecs;

/** Guardrails live on every workflow, so they are validated independently of any recipe. */
export const workflowGuardrailFields = {
  interval: workflowFieldSpecs.intervalSeconds,
  expires: { ...workflowFieldSpecs.expiresAt, optional: true },
  usdcCap: {
    kind: 'number',
    label: 'Maximum USDC per run',
    subject: 'The per-run USDC cap',
    noun: 'a USDC cap',
    unit: 'USDC',
    decimals: 6,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    optional: true,
    hint: 'Required when a path spends USDC, and a run never spends more than this. Leave it blank only when the workflow does not spend USDC.',
    placeholder: '1',
  },
  wethCap: {
    kind: 'number',
    label: 'Maximum WETH per run',
    subject: 'The per-run WETH cap',
    noun: 'a WETH cap',
    unit: 'WETH',
    decimals: 18,
    minimum: 1n,
    maximum: maxAmount,
    maximumText: 'the contract maximum',
    optional: true,
    hint: 'Required when a path sells WETH, and a run never sells more than this. Leave it blank only when the workflow does not sell WETH.',
    placeholder: '0.01',
  },
  slippage: {
    kind: 'number',
    label: 'Maximum swap slippage (%)',
    subject: 'The maximum slippage',
    noun: 'a slippage percentage',
    unit: '%',
    decimals: 2,
    maximum: 1_000n,
    optional: true,
    hint: 'At least 0.01% and at most 10%.',
    placeholder: '1',
  },
} as const satisfies Record<string, NumberFieldSpec>;

/** Return the first issue for a field, or undefined when the value is acceptable. */
export function fieldIssue(spec: WorkflowFieldSpec, value: string | undefined) {
  if (spec.kind === 'address') return addressIssue(value, spec);
  if (spec.kind === 'direction') {
    return value === 'rising' || value === 'falling'
      ? undefined
      : 'Select whether the alert fires at or above the target or at or below it.';
  }
  return amountIssue(value, spec);
}

export function readField(spec: NumberFieldSpec, value: string | undefined): bigint;
export function readField(spec: AddressFieldSpec, value: string | undefined): Address;
export function readField(
  spec: DirectionFieldSpec,
  value: string | undefined,
): 'rising' | 'falling';
export function readField(
  spec: WorkflowFieldSpec,
  value: string | undefined,
): bigint | Address | 'rising' | 'falling' {
  if (spec.kind === 'direction') {
    const issue = fieldIssue(spec, value);
    if (issue) throw new Error(issue);
    return value === 'falling' ? 'falling' : 'rising';
  }
  if (spec.kind === 'address') return readAddressField(value, spec);
  return readAmountField(value, spec);
}

/** The inputs the configurator shows for each recipe, in display order. */
export const workflowV2RecipeFields = {
  'scheduled-buy': ['intervalSeconds', 'buyUsdc', 'slippagePercent'],
  'buy-the-dip': ['intervalSeconds', 'dipPercent', 'buyUsdc', 'slippagePercent'],
  'limit-buy': ['limitPrice', 'buyUsdc', 'slippagePercent', 'expiresAt'],
  'take-profit': ['targetPrice', 'sellWeth', 'slippagePercent', 'expiresAt'],
  'trailing-stop': ['stopPrice', 'trailPercent', 'sellWeth', 'slippagePercent'],
  'price-band': ['referencePrice', 'bandPercent', 'buyUsdc', 'sellWeth', 'slippagePercent'],
  'recurring-transfer': ['intervalSeconds', 'sendUsdc', 'recipient'],
  'income-sweep': [
    'minimumPaymentUsdc',
    'sendUsdc',
    'smallPaymentUsdc',
    'smallSweepUsdc',
    'recipient',
  ],
  'balance-refill': ['intervalSeconds', 'floorUsdc', 'refillUsdc'],
  'inactivity-payout': ['intervalSeconds', 'inactivitySeconds', 'sendUsdc', 'recipient'],
  'price-alert': ['targetPrice', 'direction'],
  'price-range-alert': ['lowerPrice', 'upperPrice'],
  'large-transfer-alert': ['token', 'watchedWallet', 'minimumTransferRaw'],
} as const satisfies Record<WorkflowV2RecipeId, readonly WorkflowFieldName[]>;
