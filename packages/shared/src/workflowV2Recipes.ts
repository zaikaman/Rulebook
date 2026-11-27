import { formatUnits, zeroAddress, type Address } from 'viem';

import { UNICHAIN_SEPOLIA_CHAIN_ID, type FundsChainId } from './chains.js';
import { readField, workflowFieldSpecs, type WorkflowFieldName } from './workflowFields.js';
import { readAddressField } from './workflowValidation.js';
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
  chain?: FundsChainId;
  originChain?: FundsChainId;
  vault?: Address;
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
  private readonly vault?: Address;

  constructor(
    recipe: Recipe,
    readonly values: Values,
    options: RecipeOptions = {},
  ) {
    const chain = options.chain ?? UNICHAIN_SEPOLIA_CHAIN_ID;
    this.vault = options.vault;
    this.program = {
      chain,
      originChain: options.originChain ?? chain,
      trigger: recipe.trigger,
      interval: recipe.trigger === schedule ? Number(this.amount('intervalSeconds')) : 0,
      expires: 0n,
      source: zeroAddress,
      subject: zeroAddress,
      usdcCap: 0n,
      wethCap: 0n,
      slippage: 0,
      once: false,
    };
  }

  amount(name: WorkflowFieldName): bigint {
    const spec = workflowFieldSpecs[name];
    if (spec.kind !== 'number') throw new Error(`${spec.label} is not a numeric setting.`);
    return readField(spec, this.values[name]);
  }

  address(name: WorkflowFieldName): Address {
    const spec = workflowFieldSpecs[name];
    if (spec.kind !== 'address') throw new Error(`${spec.label} is not an address setting.`);
    return readAddressField(
      this.values[name],
      name === 'recipient' && this.vault
        ? {
            ...spec,
            disallowed: this.vault,
            disallowedMessage: 'Recipient address cannot be your Vault address.',
          }
        : spec,
    );
  }

  expiry() {
    this.program.expires = this.amount('expiresAt');
  }

  swap(kind: typeof action.buy | typeof action.sell) {
    this.program.slippage = Number(this.amount('slippagePercent'));
    const buying = kind === action.buy;
    return {
      actions: [fixed(kind, this.amount(buying ? 'buyUsdc' : 'sellWeth'))],
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
    build: (b) => when(check.dipBy, b.amount('dipPercent'), b.swap(action.buy)),
  },
  'limit-buy': {
    title: 'Limit buy',
    category: 'Trading',
    trigger: price,
    build: (b) => {
      b.expiry();
      b.program.once = true;
      return when(check.priceAtMost, b.amount('limitPrice'), b.swap(action.buy));
    },
  },
  'take-profit': {
    title: 'Take profit',
    category: 'Trading',
    trigger: price,
    build: (b) => {
      b.expiry();
      b.program.once = true;
      return when(check.priceAtLeast, b.amount('targetPrice'), b.swap(action.sell));
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
        b.amount('stopPrice'),
        sell,
        when(check.trailing, b.amount('trailPercent'), sell),
      );
    },
  },
  'price-band': {
    title: 'Price-band trading',
    category: 'Trading',
    trigger: price,
    build: (b) => {
      const band = b.amount('bandPercent');
      const reference = b.amount('referencePrice');
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
      const usdc = (value: bigint) => `${formatUnits(value, 6)} USDC`;
      if (send.actions[0].amount > floor)
        throw new Error(
          `Set the sweep at or below the ${usdc(floor)} minimum payment, or raise the minimum payment.`,
        );
      if (!b.values.smallPaymentUsdc?.trim() && !b.values.smallSweepUsdc?.trim())
        return when(check.amountAtLeast, floor, send);
      if (Boolean(b.values.smallPaymentUsdc?.trim()) !== Boolean(b.values.smallSweepUsdc?.trim()))
        throw new Error(
          'Enter both the smaller payment threshold and the smaller sweep, or leave both blank.',
        );
      const smallerPayment = b.amount('smallPaymentUsdc');
      const smallerSweep = b.amount('smallSweepUsdc');
      if (smallerPayment >= floor)
        throw new Error(
          `Set the smaller payment threshold below the ${usdc(floor)} minimum payment.`,
        );
      if (smallerSweep > smallerPayment)
        throw new Error(
          `Set the smaller sweep at or below the ${usdc(smallerPayment)} smaller payment threshold.`,
        );
      if (smallerSweep >= send.actions[0].amount)
        throw new Error(
          `Set the smaller sweep below the ${usdc(send.actions[0].amount)} main sweep.`,
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
      return when(check.inactivity, b.amount('inactivitySeconds'), b.send(action.inactivityPayout));
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
        b.amount('targetPrice'),
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
      const lower = b.amount('lowerPrice');
      const upper = b.amount('upperPrice');
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
      b.program.subject = b.address('watchedWallet');
      b.program.once = true;
      return when(check.amountAbove, b.amount('minimumTransferRaw'), alert);
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
  const builder = new RecipeBuilder(recipe, values, options);
  return builder.finish(recipe.build(builder, options));
}
