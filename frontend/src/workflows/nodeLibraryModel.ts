import {
  workflowActionKinds,
  workflowLimits,
  workflowTriggers,
  type WorkflowAction,
  type WorkflowDraft,
  type WorkflowTrigger,
} from '@rulebook/shared';

import { emptyPath, replaceNode } from './model';

export const workflowNodeMime = 'application/x-rulebook-workflow-node';
export const workflowRootKey = 'root';
export type LibraryNode = WorkflowTrigger | WorkflowAction['kind'] | 'condition';
export type LibraryTarget = { owner: 'trigger' | number; afterStep?: number };

export function branchPathKey(path: string, branch: 'yes' | 'otherwise') {
  return `${path}-${branch}`;
}

export function stepPathKey(path: string, index: number) {
  return index === 0 ? path : `${path}-step-${index}`;
}

export function isLibraryNode(value: string): value is LibraryNode {
  return (
    value === 'condition' ||
    [...workflowTriggers, ...workflowActionKinds].some((kind) => kind === value)
  );
}

export function isTriggerNode(value: LibraryNode): value is WorkflowTrigger {
  return workflowTriggers.some((trigger) => trigger === value);
}

export function workflowPaths(draft: WorkflowDraft) {
  const paths: { id: number; key: string; label: string; depth: number }[] = [];
  function visit(id: number, key: string, branches: string[], visited: Set<number>) {
    const node = draft.nodes[id];
    if (!node || visited.has(id)) return;
    visited.add(id);
    if (node.type === 'path') {
      paths.push({
        id,
        key,
        label: branches.length ? branches.join(' / ') : 'First path',
        depth: branches.length,
      });
      return;
    }
    visit(node.yes, branchPathKey(key, 'yes'), [...branches, 'Yes'], visited);
    visit(node.no, branchPathKey(key, 'otherwise'), [...branches, 'Otherwise'], visited);
  }
  visit(0, workflowRootKey, [], new Set());
  return paths;
}

function insertionIndex(stepCount: number, afterStep?: number) {
  return afterStep === undefined ? stepCount : afterStep + 1;
}

export function keepStepPositions<T>(
  positions: Record<string, T>,
  draft: WorkflowDraft,
  kind: LibraryNode,
  target: LibraryTarget,
) {
  if (isTriggerNode(kind) || target.owner === 'trigger') return positions;
  const path = workflowPaths(draft).find((item) => item.id === target.owner);
  const node = draft.nodes[target.owner];
  if (!path || node?.type !== 'path' || node.actions.length === 0) return positions;

  const branching = kind === 'condition';
  const start = branching ? 0 : insertionIndex(node.actions.length, target.afterStep);
  const next = { ...positions };
  for (let index = start; index <= node.actions.length; index++)
    delete next[stepPathKey(path.key, index)];
  const destination = branching ? branchPathKey(path.key, 'yes') : path.key;
  for (let index = start; index < node.actions.length; index++) {
    const position = positions[stepPathKey(path.key, index)];
    if (position !== undefined)
      next[stepPathKey(destination, branching ? index : index + 1)] = position;
  }
  return next;
}

export function keepEditedStepPositions<T>(
  positions: Record<string, T>,
  draft: WorkflowDraft,
  owner: number,
  actions: WorkflowAction[],
) {
  const path = workflowPaths(draft).find((item) => item.id === owner);
  const previous = draft.nodes[owner];
  if (!path || previous?.type !== 'path') return positions;
  const next = { ...positions };
  previous.actions.forEach((_, index) => delete next[stepPathKey(path.key, index)]);
  actions.forEach((action, index) => {
    const oldIndex = previous.actions.indexOf(action);
    if (oldIndex < 0) return;
    const position = positions[stepPathKey(path.key, oldIndex)];
    if (position !== undefined) next[stepPathKey(path.key, index)] = position;
  });
  return next;
}

export function placementProblem(draft: WorkflowDraft, kind: LibraryNode, target: LibraryTarget) {
  if (isTriggerNode(kind)) {
    if (target.owner !== 'trigger') return 'Drop a trigger on the current trigger to replace it.';
    if (kind === draft.trigger) return undefined;
    if (kind === 'schedule' && draft.nodes.some((node) => node.type === 'condition')) {
      return 'Remove the conditions before switching to a schedule.';
    }
    if (
      kind !== 'payment' &&
      draft.nodes.some(
        (node) =>
          node.type === 'path' &&
          node.actions.some((step) => step.kind !== 'alert' && step.unit === 'percent'),
      )
    ) {
      return 'Change payment percentages to fixed amounts before switching triggers.';
    }
    return undefined;
  }

  if (target.owner === 'trigger') return 'Choose a path under the trigger or a condition.';
  const node = draft.nodes[target.owner];
  if (node?.type !== 'path') return 'Choose a path under the trigger or a condition.';
  if (target.afterStep !== undefined && !node.actions[target.afterStep])
    return 'Choose an existing step or an empty path.';
  if (kind === 'condition') {
    if (draft.trigger === 'schedule') return 'Conditions need a payment or price trigger.';
    if (target.afterStep !== undefined && target.afterStep !== 0) {
      return 'Drop the condition on the first step to put it before the path.';
    }
    const path = workflowPaths(draft).find((item) => item.id === target.owner);
    if (
      !path ||
      draft.nodes.length + 2 > workflowLimits.nodes ||
      path.depth >= workflowLimits.conditionDepth
    ) {
      return 'This workflow has reached its condition limit.';
    }
    return undefined;
  }
  if (node.actions.length >= workflowLimits.stepsPerPath)
    return `A path can contain up to ${workflowLimits.stepsPerPath} steps.`;
  if (kind === 'swap' && node.actions.some((step) => step.kind === 'swap')) {
    return 'A path can contain only one swap.';
  }
  return undefined;
}

export function placeLibraryNode(draft: WorkflowDraft, kind: LibraryNode, target: LibraryTarget) {
  const error = placementProblem(draft, kind, target);
  if (error) return { error } as const;
  if (isTriggerNode(kind)) {
    if (kind === draft.trigger) return { draft };
    const needsThresholds = draft.nodes.some((node) => node.type === 'condition');
    return {
      draft: {
        ...draft,
        trigger: kind,
        nodes: needsThresholds
          ? draft.nodes.map((node) => (node.type === 'condition' ? { ...node, amount: '' } : node))
          : draft.nodes,
      },
      notice: needsThresholds
        ? 'Set new condition thresholds for this trigger before reviewing.'
        : undefined,
    };
  }
  if (target.owner === 'trigger') return { error: 'Choose a path first.' } as const;
  const node = draft.nodes[target.owner];
  if (node?.type !== 'path') return { error: 'Choose a path first.' } as const;
  if (kind === 'condition') {
    const yes = draft.nodes.length;
    const next = replaceNode(draft, target.owner, {
      type: 'condition',
      amount: '',
      yes,
      no: yes + 1,
    });
    return { draft: { ...next, nodes: [...next.nodes, node, emptyPath] } };
  }

  const steps = node.actions.slice();
  steps.splice(insertionIndex(steps.length, target.afterStep), 0, {
    kind,
    unit: 'fixed',
    amount: '',
    recipient: '',
  });
  return { draft: replaceNode(draft, target.owner, { type: 'path', actions: steps }) };
}
