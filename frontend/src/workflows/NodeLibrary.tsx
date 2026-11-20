import {
  Add01Icon,
  ArrowUpRight01Icon,
  Exchange01Icon,
  FlashIcon,
  GitBranchIcon,
  Notification01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { workflowActionLabels, workflowTriggerLabels, type WorkflowDraft } from '@rulebook/shared';
import { useEffect, useRef, useState } from 'react';

import {
  isTriggerNode,
  placementProblem,
  workflowNodeMime,
  workflowPaths,
  type LibraryNode,
  type LibraryTarget,
} from './nodeLibraryModel';

const catalog = {
  payment: {
    label: workflowTriggerLabels.payment,
    detail: 'When USDC reaches your Vault',
    icon: FlashIcon,
  },
  schedule: {
    label: workflowTriggerLabels.schedule,
    detail: 'Repeat at an hourly interval',
    icon: FlashIcon,
  },
  price: {
    label: workflowTriggerLabels.price,
    detail: 'Watch the WETH price in USDC',
    icon: FlashIcon,
  },
  condition: {
    label: 'Condition',
    detail: 'Create Yes and Otherwise paths',
    icon: GitBranchIcon,
  },
  send: {
    label: workflowActionLabels.send,
    detail: 'Transfer USDC to a wallet',
    icon: ArrowUpRight01Icon,
  },
  swap: { label: workflowActionLabels.swap, detail: 'Swap USDC for WETH', icon: Exchange01Icon },
  alert: {
    label: workflowActionLabels.alert,
    detail: 'Record an alert on-chain',
    icon: Notification01Icon,
  },
};

const groups: { label: string; kinds: readonly LibraryNode[] }[] = [
  { label: 'Triggers', kinds: ['payment', 'schedule', 'price'] },
  { label: 'Logic', kinds: ['condition'] },
  { label: 'Actions', kinds: ['send', 'swap', 'alert'] },
];

export function NodeLibrary({
  draft,
  path,
  onAdd,
  onDrag,
}: {
  draft: WorkflowDraft;
  path?: number;
  onAdd: (kind: LibraryNode, target: LibraryTarget) => void;
  onDrag: (kind: LibraryNode | null) => void;
}) {
  const [pending, setPending] = useState<LibraryNode>();
  const firstPath = useRef<HTMLButtonElement>(null);
  const source = useRef<HTMLButtonElement>(null);
  const paths = workflowPaths(draft);

  useEffect(() => {
    if (pending) firstPath.current?.focus();
  }, [pending]);

  function pick(kind: LibraryNode, origin: HTMLButtonElement) {
    if (isTriggerNode(kind)) {
      onAdd(kind, { owner: 'trigger' });
      return;
    }
    const available = paths.filter((item) => !placementProblem(draft, kind, { owner: item.id }));
    const target =
      available.find((item) => item.id === path) ?? (paths.length === 1 ? available[0] : undefined);
    if (target) onAdd(kind, { owner: target.id });
    else {
      source.current = origin;
      setPending(kind);
    }
  }

  const preferred = paths.find((item) => item.id === path);
  if (pending) {
    return (
      <section className="workflow-library" aria-label="Choose a path">
        <h2>Where should it go?</h2>
        <p className="app-copy">{catalog[pending].label}</p>
        <div className="workflow-library-paths">
          {paths
            .filter((item) => !placementProblem(draft, pending, { owner: item.id }))
            .map((item, index) => (
              <button
                ref={index === 0 ? firstPath : undefined}
                key={item.id}
                type="button"
                className="app-button"
                onClick={() => onAdd(pending, { owner: item.id })}
              >
                {item.label}
              </button>
            ))}
        </div>
        <button
          type="button"
          className="workflow-text-button"
          onClick={() => {
            setPending(undefined);
            requestAnimationFrame(
              () => source.current && document.getElementById(source.current.id)?.focus(),
            );
          }}
        >
          Back to nodes
        </button>
      </section>
    );
  }

  return (
    <section className="workflow-library" aria-label="Node library">
      <p className="workflow-library-intro">
        <span className="workflow-library-drag-hint">
          Drag a node onto the canvas or select it here.
        </span>
        <span className="workflow-library-touch-hint">
          Select a node to add it to your workflow.
        </span>
      </p>
      {groups
        .filter((group) => !preferred || group.label === 'Actions')
        .map((group) => (
          <div className="workflow-library-group" key={group.label}>
            <h2>{group.label}</h2>
            {group.label === 'Actions' && preferred && (
              <p className="workflow-library-context">
                Select a step to add it to {preferred.label}.
              </p>
            )}
            {group.kinds.map((kind) => {
              const entry = catalog[kind];
              const current = kind === draft.trigger;
              const blocked = isTriggerNode(kind)
                ? placementProblem(draft, kind, { owner: 'trigger' })
                : preferred
                  ? placementProblem(draft, kind, { owner: preferred.id })
                  : paths.every((item) => placementProblem(draft, kind, { owner: item.id }))
                    ? placementProblem(draft, kind, { owner: paths[0]?.id ?? 0 })
                    : undefined;
              return (
                <button
                  id={'workflow-library-' + kind}
                  key={kind}
                  type="button"
                  className="workflow-library-item"
                  disabled={Boolean(blocked)}
                  draggable={!blocked}
                  onClick={(event) => pick(kind, event.currentTarget)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData(workflowNodeMime, kind);
                    onDrag(kind);
                  }}
                  onDragEnd={() => onDrag(null)}
                >
                  <span
                    className="workflow-library-icon"
                    data-group={group.label}
                    aria-hidden="true"
                  >
                    <HugeiconsIcon icon={entry.icon} size={17} />
                  </span>
                  <span>
                    <strong>{entry.label}</strong>
                    <small>{blocked ?? (current ? 'Current trigger' : entry.detail)}</small>
                  </span>
                  <HugeiconsIcon
                    className="workflow-library-add"
                    icon={current ? Tick02Icon : Add01Icon}
                    size={13}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        ))}
    </section>
  );
}
