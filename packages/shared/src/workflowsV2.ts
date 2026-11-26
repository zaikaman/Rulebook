import { decodeAbiParameters, encodeAbiParameters, getAbiItem, type Hex } from 'viem';

import { workflowProgramValidatorV2Abi } from './abi/index.js';
import { isFundsChain, isSameNetworkMode } from './chains.js';
import { workflowLimits } from './workflows.js';

export const workflowV2Trigger = {
  schedule: 1,
  payment: 2,
  price: 3,
  transfer: 4,
} as const;

export const workflowV2Check = {
  amountAtLeast: 1,
  priceAtLeast: 2,
  priceBelow: 3,
  priceOutside: 4,
  dipBy: 5,
  trailing: 6,
  aboveReference: 7,
  belowReference: 8,
  usdcBelow: 9,
  inactivity: 10,
  priceRisesThrough: 16,
  priceFallsThrough: 17,
  paymentFrom: 18,
  priceAtMost: 19,
  amountAbove: 20,
} as const;

export const workflowV2Action = {
  send: 1,
  buy: 2,
  sell: 3,
  refill: 4,
  alert: 8,
  inactivityPayout: 10,
} as const;

export const workflowV2Unit = { fixed: 0, percent: 1 } as const;

/** Mirrors `WorkflowAgentV2.MAX_ACTIVE`, which remains the enforcing limit. */
export const workflowV2Limits = { activePerAgent: 4 } as const;

export const workflowV2ProgramParameters = getAbiItem({
  abi: workflowProgramValidatorV2Abi,
  name: 'validateProgram',
}).outputs;

type EncodedProgram = Parameters<
  typeof encodeAbiParameters<typeof workflowV2ProgramParameters>
>[1][0];
export type WorkflowV2Program = Omit<EncodedProgram, 'version'>;
export type WorkflowV2Step = WorkflowV2Program['nodes'][number]['actions'][number];

export type WorkflowV2Branch =
  | { actions: readonly WorkflowV2Step[] }
  | {
      check: (typeof workflowV2Check)[keyof typeof workflowV2Check];
      value?: bigint;
      upper?: bigint;
      yes: WorkflowV2Branch;
      no: WorkflowV2Branch;
    };

export function workflowV2Nodes(root: WorkflowV2Branch): WorkflowV2Program['nodes'] {
  const nodes: WorkflowV2Program['nodes'][number][] = [];
  function append(branch: WorkflowV2Branch, depth: number): number {
    if (nodes.length >= workflowLimits.nodes) throw new Error('This workflow has too many nodes.');
    const index = nodes.length;
    if ('actions' in branch) {
      if (branch.actions.length > workflowLimits.stepsPerPath)
        throw new Error('A workflow path can have up to three actions.');
      nodes.push({ check: 0, yes: 0, no: 0, value: 0n, upper: 0n, actions: branch.actions });
      return index;
    }
    if (depth >= workflowLimits.conditionDepth)
      throw new Error('A workflow path can have up to three checks.');
    const node = {
      check: branch.check,
      yes: 0,
      no: 0,
      value: branch.value ?? 0n,
      upper: branch.upper ?? 0n,
      actions: [],
    };
    nodes.push(node);
    node.yes = append(branch.yes, depth + 1);
    node.no = append(branch.no, depth + 1);
    return index;
  }
  append(root, 0);
  return nodes;
}

/** Uses the settlement validator's generated ABI so its tuple order stays in sync with Solidity. */
export function encodeWorkflowV2(program: WorkflowV2Program): Hex {
  if (!isFundsChain(program.chain) || !isFundsChain(program.originChain))
    throw new Error('Select a supported workflow network.');
  if (!isSameNetworkMode(program.chain, program.originChain))
    throw new Error(
      'Settlement and watched trigger networks must both be testnet or both be mainnet.',
    );
  return encodeAbiParameters(workflowV2ProgramParameters, [{ ...program, version: 2 }]);
}

export function decodeWorkflowV2(encoded: Hex): WorkflowV2Program {
  const [{ version, ...program }] = decodeAbiParameters(workflowV2ProgramParameters, encoded);
  if (version !== 2 || encodeWorkflowV2(program).toLowerCase() !== encoded.toLowerCase())
    throw new Error('This workflow program is unavailable.');
  return program;
}
