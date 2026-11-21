import {
  workflowV2Check as C,
  workflowV2Trigger as T,
  type V2Draft,
  type TriggerCode,
  type CheckCode,
  type ActionCode,
  type WorkflowV2RecipeId,
} from '@rulebook/shared';

export {
  actionDecimals,
  actions,
  checkDecimals,
  checks,
  emptyDraft,
  emptyPath,
  toDraft,
  toProgram,
  triggers,
  v2DraftSchema,
} from '@rulebook/shared';
export type {
  ActionCode,
  CheckCode,
  DraftPath,
  DraftStep,
  TriggerCode,
  V2Draft,
} from '@rulebook/shared';

export type NodeTool =
  | { group: 'trigger'; code: TriggerCode }
  | { group: 'check'; code: CheckCode }
  | { group: 'action'; code: ActionCode };
export function unavailable(tool: NodeTool, draft: V2Draft) {
  const { code } = tool;
  if (tool.group === 'check') {
    if (
      [
        C.trailing,
        C.aboveReference,
        C.belowReference,
        C.priceRisesThrough,
        C.priceFallsThrough,
      ].some((check) => check === code) &&
      draft.trigger !== T.price
    )
      return 'Needs the pool price trigger.';
    if (code === C.dipBy && draft.trigger !== T.schedule) return 'Needs a schedule.';
    if (code === C.inactivity && draft.trigger !== T.schedule)
      return 'Uses a Unichain Sepolia schedule.';
    if (code === C.paymentFrom && draft.trigger !== T.payment)
      return 'Needs the USDC payment trigger.';
    if (
      (code === C.amountAtLeast || code === C.amountAbove) &&
      ![T.payment, T.transfer].some((trigger) => trigger === draft.trigger)
    )
      return 'Needs a payment or transfer trigger.';
  }
  return undefined;
}

const schedule = 'intervalSeconds';
const slippage = 'slippagePercent';
export const recipeFields: Record<WorkflowV2RecipeId, string[]> = {
  'scheduled-buy': [schedule, 'buyUsdc', slippage],
  'buy-the-dip': [schedule, 'dipPercent', 'buyUsdc', slippage],
  'limit-buy': ['limitPrice', 'buyUsdc', slippage, 'expiresAt'],
  'take-profit': ['targetPrice', 'sellWeth', slippage, 'expiresAt'],
  'trailing-stop': ['stopPrice', 'trailPercent', 'sellWeth', slippage],
  'price-band': ['referencePrice', 'bandPercent', 'buyUsdc', 'sellWeth', slippage],
  'recurring-transfer': [schedule, 'sendUsdc', 'recipient'],
  'income-sweep': [
    'minimumPaymentUsdc',
    'sendUsdc',
    'smallPaymentUsdc',
    'smallSweepUsdc',
    'recipient',
  ],
  'balance-refill': [schedule, 'floorUsdc', 'refillUsdc'],
  'inactivity-payout': [schedule, 'inactivitySeconds', 'sendUsdc', 'recipient'],
  'price-alert': ['targetPrice', 'direction'],
  'price-range-alert': ['lowerPrice', 'upperPrice'],
  'large-transfer-alert': ['token', 'minimumTransferRaw'],
};

export const recipeLabels: Record<string, string> = {
  intervalSeconds: 'Interval in seconds',
  expiresAt: 'Expires at (Unix seconds)',
  buyUsdc: 'USDC to spend',
  sellWeth: 'WETH to sell',
  slippagePercent: 'Maximum slippage (%)',
  dipPercent: 'Dip from previous price (%)',
  limitPrice: 'Limit price (USDC per WETH)',
  targetPrice: 'Target price (USDC per WETH)',
  stopPrice: 'Stop price (USDC per WETH)',
  trailPercent: 'Trail from high price (%)',
  bandPercent: 'Band width (%)',
  referencePrice: 'Starting reference price (USDC per WETH)',
  recipient: 'Recipient address',
  sendUsdc: 'USDC to send',
  minimumPaymentUsdc: 'Minimum payment (USDC)',
  smallPaymentUsdc: 'Smaller payment threshold (USDC, optional)',
  smallSweepUsdc: 'Smaller sweep amount (USDC, optional)',
  floorUsdc: 'Balance floor (USDC)',
  refillUsdc: 'Maximum refill (USDC)',
  inactivitySeconds: 'Time without activity (seconds)',
  lowerPrice: 'Lower price (USDC per WETH)',
  upperPrice: 'Upper price (USDC per WETH)',
  token: 'Token contract address',
  minimumTransferRaw: 'Transfer threshold in token base units',
};
