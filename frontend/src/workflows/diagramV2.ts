import {
  workflowV2Action as A,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type WorkflowV2Program,
} from '@rulebook/shared';
import type { CanvasDraft, CanvasNode } from './Graph';
import { actions, checks, triggers, type DraftPath, type V2Draft } from './modelV2';
import { branchPathKey, workflowRootKey } from './nodeLibraryModel';

export function diagramV2(draft: V2Draft) {
  const paths: { path: DraftPath; anchor: string; depth: number }[] = [];
  const nodes: CanvasNode[] = [];
  function visit(path: DraftPath, anchor: string, depth: number): number {
    const index = paths.length;
    paths.push({ path, anchor, depth });
    if ('steps' in path) {
      nodes[index] = {
        actions: path.steps.map((step) => {
          const meta = actions[step.kind];
          return {
            kind:
              step.kind === A.buy || step.kind === A.sell
                ? 'swap'
                : step.kind === A.alert
                  ? 'alert'
                  : 'send',
            title: meta.name,
            detail: step.amount
              ? `${step.amount} ${step.unit === U.percent ? '% of payment' : (meta.asset ?? '')}`
              : undefined,
          };
        }),
      };
    } else {
      nodes[index] = {
        title: [checks[path.check].name, path.value, path.upper && `– ${path.upper}`]
          .filter(Boolean)
          .join(' '),
        yes: visit(path.yes, branchPathKey(anchor, 'yes'), depth + 1),
        no: visit(path.no, branchPathKey(anchor, 'otherwise'), depth + 1),
      };
    }
    return index;
  }
  visit(draft.root, workflowRootKey, 0);
  const trigger =
    draft.trigger === T.schedule && draft.interval
      ? `Every ${draft.interval} seconds`
      : triggers[draft.trigger];
  return { canvas: { trigger, nodes } satisfies CanvasDraft, paths };
}

export function replacePath(root: DraftPath, target: DraftPath, replacement: DraftPath): DraftPath {
  if (root === target) return replacement;
  if ('steps' in root) return root;
  return {
    ...root,
    yes: replacePath(root.yes, target, replacement),
    no: replacePath(root.no, target, replacement),
  };
}

export function canvasLeaf(program: WorkflowV2Program, path: number | null) {
  if (path === null) return undefined;
  const indexes: number[] = [];
  function visit(index: number) {
    const node = program.nodes[index];
    if (!node) return;
    indexes.push(index);
    if (node.check) {
      visit(node.yes);
      visit(node.no);
    }
  }
  visit(0);
  const index = indexes.indexOf(path);
  return index === -1 ? undefined : index;
}
