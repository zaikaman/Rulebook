import {
  decodeAbiParameters,
  encodeAbiParameters,
  isAddress,
  parseUnits,
  zeroAddress,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem';
import { z } from 'zod';

const PROG = [
  {
    type: 'tuple',
    components: [
      { name: 'version', type: 'uint8' },
      { name: 'trigger', type: 'uint8' },
      { name: 'target', type: 'uint128' },
      { name: 'rising', type: 'bool' },
      { name: 'spendLimit', type: 'uint96' },
      { name: 'slippage', type: 'uint16' },
      {
        name: 'nodes',
        type: 'tuple[]',
        components: [
          { name: 'threshold', type: 'uint128' },
          { name: 'yes', type: 'uint8' },
          { name: 'no', type: 'uint8' },
          {
            name: 'actions',
            type: 'tuple[]',
            components: [
              { name: 'kind', type: 'uint8' },
              { name: 'unit', type: 'uint8' },
              { name: 'amount', type: 'uint96' },
              { name: 'recipient', type: 'address' },
            ],
          },
        ],
      },
    ],
  },
] as const satisfies readonly AbiParameter[];

export const workflowTriggers = ['payment', 'schedule', 'price'] as const;
export const workflowActionKinds = ['send', 'swap', 'alert'] as const;
export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('condition'),
    amount: z.string(),
    yes: z.number().int().nonnegative(),
    no: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('path'),
    actions: z
      .array(
        z.object({
          kind: z.enum(workflowActionKinds),
          amount: z.string(),
          unit: z.enum(['fixed', 'percent']),
          recipient: z.string(),
        }),
      )
      .max(3),
  }),
]);

export const workflowDraftSchema = z.object({
  title: z.string().max(80),
  trigger: z.enum(workflowTriggers),
  intervalHours: z.string(),
  price: z.string(),
  rising: z.boolean(),
  spendLimit: z.string(),
  slippage: z.string(),
  nodes: z.array(workflowNodeSchema).min(1).max(15),
});

export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowAction = Extract<WorkflowNode, { type: 'path' }>['actions'][number];
export type WorkflowTrigger = WorkflowDraft['trigger'];

export const workflowTriggerLabels: Record<WorkflowTrigger, string> = {
  payment: 'Receive USDC',
  schedule: 'On a schedule',
  price: 'Price crosses a target',
};

export const workflowActionLabels: Record<WorkflowAction['kind'], string> = {
  send: 'Send USDC',
  swap: 'Buy WETH with USDC',
  alert: 'Record an alert',
};

export function readAmount(value: string, decimals: number, name: string) {
  const pattern = decimals === 0 ? /^\d+$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(value.trim()) || (value.trim().split('.')[1]?.length ?? 0) > decimals) {
    throw new Error('Enter a valid ' + name + '.');
  }
  return parseUnits(value.trim(), decimals);
}

export function encodeWorkflow(input: WorkflowDraft, vault?: Address): Hex {
  const draft = workflowDraftSchema.parse(input);
  const titleBytes = new TextEncoder().encode(draft.title.trim()).length;
  if (titleBytes === 0 || titleBytes > 80)
    throw new Error('Enter a workflow name of up to 80 bytes.');
  const maxSpend = (1n << 96n) - 1n;
  const maxThreshold = (1n << 128n) - 1n;
  const spendLimit = readAmount(draft.spendLimit, 6, 'spending limit');
  const slippage = readAmount(draft.slippage, 2, 'slippage percentage');
  if (spendLimit > maxSpend || slippage > 1_000n)
    throw new Error('Check your spending limit and slippage. Slippage can be up to 10%.');
  const trigger = workflowTriggers.indexOf(draft.trigger) + 1;
  const target =
    draft.trigger === 'price'
      ? readAmount(draft.price, 18, 'target price')
      : draft.trigger === 'schedule'
        ? readAmount(draft.intervalHours, 0, 'hour interval') * 3_600n
        : 0n;
  if (draft.trigger === 'price' && (target === 0n || target > maxThreshold))
    throw new Error('Enter a positive target price.');
  if (draft.trigger === 'schedule' && (target < 3_600n || target > 2_592_000n))
    throw new Error('Set a schedule between 1 and 720 hours.');
  const depth = new Map([[0, 1]]);
  let hasAction = false;
  const nodes = draft.nodes.map((node, index) => {
    const level = depth.get(index);
    if (!level) throw new Error('A workflow path is disconnected.');
    if (node.type === 'condition') {
      const threshold = readAmount(
        node.amount,
        draft.trigger === 'price' ? 18 : 6,
        'branch threshold',
      );
      if (threshold === 0n || threshold > maxThreshold)
        throw new Error('Enter a positive branch threshold.');
      if (draft.trigger === 'schedule' || level > 3 || node.yes === node.no)
        throw new Error('This workflow cannot add another branch.');
      for (const child of [node.yes, node.no]) {
        if (child <= index || child >= draft.nodes.length || depth.has(child))
          throw new Error('A workflow path is invalid.');
        depth.set(child, level + 1);
      }
      return { threshold, yes: node.yes, no: node.no, actions: [] };
    }
    let fixed = 0n;
    let percent = 0n;
    let swapped = false;
    const actions = node.actions.map((action) => {
      hasAction = true;
      const kind = workflowActionKinds.indexOf(action.kind) + 1;
      if (action.kind === 'alert') return { kind, amount: 0n, unit: 0, recipient: zeroAddress };
      const unit = action.unit === 'percent' ? 1 : 0;
      const amount = readAmount(action.amount, unit === 1 ? 2 : 6, 'step amount');
      if (amount === 0n || amount > maxSpend) throw new Error('Enter a positive step amount.');
      if (unit === 1) {
        if (draft.trigger !== 'payment') throw new Error('Percentages require a payment trigger.');
        percent += amount;
      } else fixed += amount;
      if (action.kind === 'swap') {
        if (swapped || slippage === 0n)
          throw new Error('Use one swap per path and set a positive slippage limit.');
        swapped = true;
      }
      const recipient = action.kind === 'send' ? action.recipient.trim() : zeroAddress;
      if (
        !isAddress(recipient, { strict: false }) ||
        (action.kind === 'send' &&
          (recipient.toLowerCase() === zeroAddress ||
            recipient.toLowerCase() === vault?.toLowerCase()))
      ) {
        throw new Error('Enter a valid wallet address for each transfer.');
      }
      return { kind, amount, unit, recipient };
    });
    if (fixed > spendLimit || percent > 10_000n || (percent > 0n && spendLimit === 0n)) {
      throw new Error('Each path must fit your spending limit and use at most 100% of a payment.');
    }
    return { threshold: 0n, yes: 0, no: 0, actions };
  });
  if (!hasAction) throw new Error('Add at least one action.');
  return encodeAbiParameters(PROG, [
    {
      version: 1,
      trigger,
      target,
      rising: draft.trigger === 'price' && draft.rising,
      spendLimit,
      slippage: Number(slippage),
      nodes,
    },
  ]);
}

function displayUnits(amount: bigint, decimals: number) {
  const denominator = 10n ** BigInt(decimals);
  const fraction = (amount % denominator).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (amount / denominator).toString() + (fraction ? '.' + fraction : '');
}

export function decodeWorkflow(encoded: Hex, title: string, forCopy = false): WorkflowDraft {
  const [program] = decodeAbiParameters(PROG, encoded);
  const trigger = workflowTriggers[program.trigger - 1];
  if (program.version !== 1 || !trigger) throw new Error('This workflow version is unavailable.');
  return workflowDraftSchema.parse({
    title,
    trigger,
    intervalHours: trigger === 'schedule' ? (program.target / 3600n).toString() : '24',
    price: trigger === 'price' ? displayUnits(program.target, 18) : '',
    rising: program.rising,
    spendLimit: forCopy ? '' : displayUnits(program.spendLimit, 6),
    slippage: displayUnits(BigInt(program.slippage), 2),
    nodes: program.nodes.map((node) =>
      node.threshold > 0n
        ? {
            type: 'condition',
            amount: displayUnits(node.threshold, trigger === 'price' ? 18 : 6),
            yes: node.yes,
            no: node.no,
          }
        : {
            type: 'path',
            actions: node.actions.map((a) => ({
              kind: workflowActionKinds[a.kind - 1],
              unit: a.unit === 1 ? 'percent' : 'fixed',
              amount: a.kind === 3 ? '' : displayUnits(a.amount, a.unit === 1 ? 2 : 6),
              recipient: a.kind !== 1 || forCopy ? '' : a.recipient,
            })),
          },
    ),
  });
}

export function workflowTags(draft: WorkflowDraft): string[] {
  const tags = new Set<string>([
    draft.trigger === 'payment' ? 'Payments' : draft.trigger === 'price' ? 'Prices' : 'Schedules',
  ]);
  for (const node of draft.nodes) {
    if (node.type !== 'path') continue;
    for (const action of node.actions)
      tags.add(action.kind === 'send' ? 'Transfers' : action.kind === 'swap' ? 'Swaps' : 'Alerts');
  }
  return [...tags];
}

export const workflowHexSchema = z
  .string()
  .regex(/^0x(?:[0-9a-f]{2})+$/i)
  .transform((hex) => hex as Hex);
export const workflowIdSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/i)
  .transform((hex) => hex.toLowerCase() as Hex);
export const workflowListingSchema = z.object({
  id: z.string().regex(/^[1-9]\d*$/),
  author: z.string(),
  agent: z.string(),
  workflowId: workflowIdSchema,
  programHash: workflowIdSchema,
  program: workflowHexSchema,
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  trigger: z.enum(workflowTriggers),
  runs: z.number().int().nonnegative(),
  copies: z.number().int().nonnegative(),
});
export type WorkflowListing = z.infer<typeof workflowListingSchema>;
export const workflowRunSchema = z.object({
  id: workflowIdSchema,
  workflowId: workflowIdSchema,
  program: workflowHexSchema,
  programHash: workflowIdSchema,
  leaf: z.number().int().nonnegative(),
  observed: z.string(),
  originChain: z.number().int(),
  originTransaction: workflowIdSchema,
  originLogIndex: z.string(),
  lasnaTransaction: workflowIdSchema,
  destinationTransaction: workflowIdSchema.nullable(),
  expiresAt: z.number().int(),
  status: z.enum([
    'Completed',
    'Failed',
    'Skipped',
    'Waiting for confirmation',
    'No result confirmed',
  ]),
  reason: z.string().nullable(),
  steps: z.array(
    z.object({
      index: z.number().int(),
      kind: z.number().int(),
      amount: z.string(),
      received: z.string(),
      recipient: z.string(),
    }),
  ),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
