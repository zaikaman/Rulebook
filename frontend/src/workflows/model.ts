import {
  workflowActionLabels,
  type WorkflowAction,
  type WorkflowDraft,
  type WorkflowNode,
} from '@rulebook/shared';

export const emptyPath: WorkflowNode = { type: 'path', actions: [] };
export const alertAction: WorkflowAction = {
  kind: 'alert',
  unit: 'fixed',
  amount: '',
  recipient: '',
};

const baseDraft: WorkflowDraft = {
  title: '',
  trigger: 'payment',
  intervalHours: '24',
  price: '',
  rising: false,
  spendLimit: '',
  slippage: '0.5',
  nodes: [emptyPath],
};

export const starters = [
  {
    id: 'payment',
    label: 'Save from every payment',
    description: 'Save a different amount depending on what comes in.',
    draft: {
      ...baseDraft,
      title: 'Save from every payment',
      spendLimit: '1',
      nodes: [
        { type: 'condition', amount: '1', yes: 1, no: 2 },
        {
          type: 'path',
          actions: [{ kind: 'send', unit: 'percent', amount: '20', recipient: '' }, alertAction],
        },
        { type: 'condition', amount: '0.25', yes: 3, no: 4 },
        {
          type: 'path',
          actions: [{ kind: 'send', unit: 'percent', amount: '5', recipient: '' }, alertAction],
        },
        emptyPath,
      ],
    },
  },
  {
    id: 'schedule',
    label: 'Buy on a schedule',
    description: 'Buy a set amount of WETH every day and record the run.',
    draft: {
      ...baseDraft,
      title: 'Buy on a schedule',
      trigger: 'schedule',
      spendLimit: '1',
      nodes: [
        {
          type: 'path',
          actions: [{ kind: 'swap', unit: 'fixed', amount: '1', recipient: '' }, alertAction],
        },
      ],
    },
  },
  {
    id: 'price',
    label: 'Buy when the price drops',
    description: 'Buy WETH when the pool price falls below your target.',
    draft: {
      ...baseDraft,
      title: 'Buy when the price drops',
      trigger: 'price',
      spendLimit: '1',
      nodes: [
        {
          type: 'path',
          actions: [{ kind: 'swap', unit: 'fixed', amount: '1', recipient: '' }, alertAction],
        },
      ],
    },
  },
  {
    id: 'blank',
    label: 'Start from scratch',
    description: 'Choose your trigger and build your own paths.',
    draft: baseDraft,
  },
] satisfies { id: string; label: string; description: string; draft: WorkflowDraft }[];

export function workflowTriggerText(draft: WorkflowDraft) {
  if (draft.trigger === 'payment') return 'When your Vault receives USDC';
  if (draft.trigger === 'schedule') return 'Every ' + (draft.intervalHours || '…') + ' hours';
  return (
    'When WETH crosses ' + (draft.rising ? 'up to' : 'below') + ' ' + (draft.price || '…') + ' USDC'
  );
}

export function stepAmountText(action: WorkflowAction) {
  return (action.amount || '…') + (action.unit === 'percent' ? '% of the payment' : ' USDC');
}

export function stepText(action: WorkflowAction) {
  if (action.kind === 'alert') return workflowActionLabels.alert;
  const amount = stepAmountText(action);
  if (action.kind === 'swap') return 'Spend ' + amount + ' to buy WETH';
  return 'Send ' + amount + ' to ' + (action.recipient || 'a wallet you choose');
}

export function conditionText(
  draft: WorkflowDraft,
  node: Extract<WorkflowNode, { type: 'condition' }>,
) {
  return (
    (draft.trigger === 'price' ? 'Price is' : 'Payment is') +
    ' at least ' +
    (node.amount || '…') +
    ' USDC'
  );
}

export function replaceNode(draft: WorkflowDraft, id: number, node: WorkflowNode): WorkflowDraft {
  return { ...draft, nodes: draft.nodes.map((item, index) => (index === id ? node : item)) };
}

export function removeCondition(draft: WorkflowDraft, remove: number): WorkflowDraft {
  const nodes: WorkflowNode[] = [];
  function visit(source: number): number {
    const id = nodes.length;
    const node = draft.nodes[source] ?? emptyPath;
    nodes.push(emptyPath);
    if (source !== remove) {
      nodes[id] =
        node.type === 'condition' ? { ...node, yes: visit(node.yes), no: visit(node.no) } : node;
    }
    return id;
  }
  visit(0);
  return { ...draft, nodes };
}

export function sameWorkflowShape(a: WorkflowDraft, b: WorkflowDraft): boolean {
  if (
    a.trigger !== b.trigger ||
    (a.trigger === 'price' && a.rising !== b.rising) ||
    a.nodes.length !== b.nodes.length
  )
    return false;
  return a.nodes.every((node, i) => {
    const other = b.nodes[i];
    if (!other) return false;
    if (node.type === 'condition')
      return other.type === 'condition' && node.yes === other.yes && node.no === other.no;
    return (
      other.type === 'path' &&
      node.actions.length === other.actions.length &&
      node.actions.every(
        (action, index) =>
          action.kind === other.actions[index]?.kind && action.unit === other.actions[index]?.unit,
      )
    );
  });
}
