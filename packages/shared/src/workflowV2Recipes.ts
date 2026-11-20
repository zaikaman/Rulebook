import { isAddress, zeroAddress, type Address } from 'viem';

import { UNICHAIN_SEPOLIA_CHAIN_ID } from './chains.js';
import { readAmount } from './workflows.js';
import {
  workflowV2Action as action,
  workflowV2Check as check,
  workflowV2Nodes,
  workflowV2Trigger as trigger,
  workflowV2Unit,
  type WorkflowV2Branch,
  type WorkflowV2Program,
  type WorkflowV2Step,
} from './workflowsV2.js';

type Category = 'Trading' | 'Payments' | 'Wallet safety';
type Values = Readonly<Record<string, string | undefined>>;

interface RecipeOptions {
  inactivityPayout?: boolean;
}

interface Recipe {
  title: string;
  category: Category;
  trigger: (typeof trigger)[keyof typeof trigger];
  build: (builder: RecipeBuilder, options: RecipeOptions) => WorkflowV2Branch;
}

const skip: WorkflowV2Branch = { actions: [] };
const price = trigger.price;
const schedule = trigger.schedule;

function when(
  kind: Extract<WorkflowV2Branch, { check: number }>['check'],
  value: bigint,
  yes: WorkflowV2Branch,
  no = skip,
  upper = 0n,
): WorkflowV2Branch {
  return { check: kind, value, yes, no, upper };
}

function fixed(
  kind: WorkflowV2Step['kind'],
  amount = 0n,
  account: Address = zeroAddress,
): WorkflowV2Step {
  return { kind, amount, account, unit: workflowV2Unit.fixed };
}

const alert = { actions: [fixed(action.alert)] };

class RecipeBuilder {
  readonly program: Omit<WorkflowV2Program, 'nodes'>;

  constructor(
    recipe: Recipe,
    readonly values: Values,
  ) {
    this.program = {
      chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      trigger: recipe.trigger,
      interval:
        recipe.trigger === schedule ? Number(this.integer('intervalSeconds', 120n, 2_592_000n)) : 0,
      expires: 0n,
      source: zeroAddress,
      subject: zeroAddress,
      usdcCap: 0n,
      wethCap: 0n,
      slippage: 0,
      once: false,
    };
  }

  amount(name: string, decimals = 6, maximum = (1n << 128n) - 1n): bigint {
    return this.integer(name, 1n, maximum, decimals);
  }

  integer(name: string, minimum: bigint, maximum: bigint, decimals = 0): bigint {
    const value = readAmount(this.values[name] ?? '', decimals, name);
    if (value < minimum || value > maximum) throw new Error(`Check the value for ${name}.`);
    return value;
  }

  address(name: string): Address {
    const value = this.values[name]?.trim();
    if (!value || !isAddress(value, { strict: false }) || value.toLowerCase() === zeroAddress)
      throw new Error(`Enter a valid address for ${name}.`);
    return value;
  }

  expiry() {
    this.program.expires = this.amount('expiresAt', 0, (1n << 64n) - 1n);
  }

  swap(kind: typeof action.buy | typeof action.sell) {
    this.program.slippage = Number(this.amount('slippagePercent', 2, 1_000n));
    const buying = kind === action.buy;
    return {
      actions: [fixed(kind, this.amount(buying ? 'buyUsdc' : 'sellWeth', buying ? 6 : 18))],
    };
  }

  send(kind: typeof action.send | typeof action.inactivityPayout = action.send) {
    return { actions: [fixed(kind, this.amount('sendUsdc'), this.address('recipient'))] as const };
  }

  finish(branch: WorkflowV2Branch): WorkflowV2Program {
    const nodes = workflowV2Nodes(branch);
    for (const node of nodes) {
      let usdc = 0n;
      let weth = 0n;
      for (const step of node.actions) {
        if (step.kind === action.sell) weth += step.amount;
        else usdc += step.amount;
      }
      for (const [cap, amount] of [
        ['usdcCap', usdc],
        ['wethCap', weth],
      ] as const) {
        if (amount >= 1n << 96n) throw new Error('A path exceeds the maximum supported amount.');
        if (amount > this.program[cap]) this.program[cap] = amount;
      }
    }
    return { ...this.program, nodes };
  }
}

const recipes = {
  'scheduled-buy': {
    title: 'Scheduled buy',
    category: 'Trading',
    trigger: schedule,
    build: (b) => b.swap(action.buy),
  },
  'buy-the-dip': {
    title: 'Buy more on a dip',
    category: 'Trading',
    trigger: schedule,
    build: (b) => when(check.dipBy, b.amount('dipPercent', 2, 9_999n), b.swap(action.buy)),
  },
  'limit-buy': {
    title: 'Limit buy',
    category: 'Trading',
    trigger: price,
    build: (b) => {
      b.expiry();
      b.program.once = true;
      return when(check.priceAtMost, b.amount('limitPrice', 18), b.swap(action.buy));
    },
  },
  'take-profit': {
    title: 'Take profit',
    category: 'Trading',
    trigger: price,
    build: (b) => {
      b.expiry();
      b.program.once = true;
      return when(check.priceAtLeast, b.amount('targetPrice', 18), b.swap(action.sell));
    },
  },
  'trailing-stop': {
    title: 'Trailing stop',
    category: 'Trading',
    trigger: price,
    build: (b) => {
      b.program.once = true;
      const sell = b.swap(action.sell);
      return when(
        check.priceAtMost,
        b.amount('stopPrice', 18),
        sell,
        when(check.trailing, b.amount('trailPercent', 2, 9_999n), sell),
      );
    },
  },
  'price-band': {
    title: 'Price-band trading',
    category: 'Trading',
    trigger: price,
    build: (b) => {
      const band = b.amount('bandPercent', 2, 9_999n);
      const reference = b.amount('referencePrice', 18);
      return when(
        check.aboveReference,
        band,
        b.swap(action.sell),
        when(check.belowReference, band, b.swap(action.buy), skip, reference),
        reference,
      );
    },
  },
  'recurring-transfer': {
    title: 'Recurring transfer',
    category: 'Payments',
    trigger: schedule,
    build: (b) => b.send(),
  },
  'income-sweep': {
    title: 'Income sweep',
    category: 'Payments',
    trigger: trigger.payment,
    build: (b) => {
      const floor = b.amount('minimumPaymentUsdc');
      const send = b.send();
      if (send.actions[0].amount > floor)
        throw new Error('Set the sweep amount at or below the minimum payment.');
      if (!b.values.smallPaymentUsdc && !b.values.smallSweepUsdc)
        return when(check.amountAtLeast, floor, send);
      const smallerPayment = b.amount('smallPaymentUsdc');
      const smallerSweep = b.amount('smallSweepUsdc');
      if (
        smallerPayment >= floor ||
        smallerSweep > smallerPayment ||
        smallerSweep >= send.actions[0].amount
      )
        throw new Error(
          'Set a lower payment threshold and a smaller sweep that fits that payment.',
        );
      return when(
        check.amountAtLeast,
        floor,
        send,
        when(check.amountAtLeast, smallerPayment, {
          actions: [fixed(action.send, smallerSweep, send.actions[0].account)],
        }),
      );
    },
  },
  'balance-refill': {
    title: 'Balance refill',
    category: 'Payments',
    trigger: schedule,
    build: (b) =>
      when(check.usdcBelow, b.amount('floorUsdc'), {
        actions: [fixed(action.refill, b.amount('refillUsdc'))],
      }),
  },
  'inactivity-payout': {
    title: 'Inactivity payout',
    category: 'Wallet safety',
    trigger: schedule,
    build: (b, options) => {
      if (!options.inactivityPayout)
        throw new Error('Confirm the fixed inactivity payout before proceeding.');
      b.program.once = true;
      return when(
        check.inactivity,
        b.integer('inactivitySeconds', 86_400n, (1n << 128n) - 1n),
        b.send(action.inactivityPayout),
      );
    },
  },
  'price-alert': {
    title: 'Price alert',
    category: 'Wallet safety',
    trigger: price,
    build: (b) => {
      b.program.once = true;
      const direction = b.values.direction ?? 'rising';
      if (direction !== 'rising' && direction !== 'falling')
        throw new Error('Select which side of the target should alert.');
      return when(
        direction === 'rising' ? check.priceAtLeast : check.priceAtMost,
        b.amount('targetPrice', 18),
        alert,
      );
    },
  },
  'price-range-alert': {
    title: 'Price-range alert',
    category: 'Wallet safety',
    trigger: price,
    build: (b) => {
      b.program.once = true;
      const lower = b.amount('lowerPrice', 18);
      const upper = b.amount('upperPrice', 18);
      if (upper <= lower) throw new Error('Set an upper price above the lower price.');
      return when(check.priceOutside, lower, alert, skip, upper);
    },
  },
  'large-transfer-alert': {
    title: 'Large-transfer alert',
    category: 'Wallet safety',
    trigger: trigger.transfer,
    build: (b) => {
      b.program.source = b.address('token');
      b.program.once = true;
      return when(check.amountAbove, b.amount('minimumTransferRaw', 0), alert);
    },
  },
} satisfies Record<string, Recipe>;

export type WorkflowV2RecipeId = keyof typeof recipes;

export const workflowV2Recipes = Object.entries(recipes).map(
  ([id, recipe]) =>
    ({
      id: id as WorkflowV2RecipeId,
      title: recipe.title,
      category: recipe.category,
      chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      trigger: recipe.trigger,
    }) as const,
);

export function createWorkflowV2Recipe(
  id: WorkflowV2RecipeId,
  values: Values,
  options: RecipeOptions = {},
) {
  const recipe = recipes[id];
  const builder = new RecipeBuilder(recipe, values);
  return builder.finish(recipe.build(builder, options));
}
