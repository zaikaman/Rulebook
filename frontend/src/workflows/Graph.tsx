import { ReactFlow, Background, Controls, Position, type Edge, type Node } from '@xyflow/react';
import { useMemo } from 'react';
import { workflowActionLabels, type WorkflowDraft } from '@rulebook/shared';
import { conditionText, stepText, workflowTriggerText } from './model';
import '@xyflow/react/dist/style.css';

export type GraphSelection = 'trigger' | number;

function highlightedPath(draft: WorkflowDraft, leaf: number | undefined) {
  const path = new Set<number>();
  if (leaf === undefined) return path;
  function find(id: number): boolean {
    const node = draft.nodes[id];
    if (!node) return false;
    if (id === leaf || (node.type === 'condition' && (find(node.yes) || find(node.no)))) {
      path.add(id);
      return true;
    }
    return false;
  }
  find(0);
  return path;
}

export function WorkflowGraph({
  draft,
  selected,
  select,
  leaf,
}: {
  draft: WorkflowDraft;
  selected?: GraphSelection;
  select?: (selection: GraphSelection) => void;
  leaf?: number;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const highlight = highlightedPath(draft, leaf);
    const readOnly = !select;
    let nextRow = 0;
    function box(
      id: string,
      owner: GraphSelection,
      label: string,
      detail: string,
      column: number,
      row: number,
      kind: string,
    ) {
      const active = owner === 'trigger' ? leaf !== undefined : highlight.has(owner);
      nodes.push({
        id,
        position: { x: row * 230, y: column * 106 },
        draggable: false,
        connectable: false,
        selected: owner === selected,
        selectable: !readOnly,
        focusable: !readOnly,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        data: {
          owner,
          label: (
            <>
              <span className="workflow-node-kind">{kind}</span>
              <strong>{label}</strong>
              <span>{detail}</span>
            </>
          ),
        },
        className: 'workflow-node' + (active ? ' workflow-node--matched' : ''),
        ariaLabel: kind + '. ' + label,
      });
    }
    function connect(source: string, target: string, label: string | undefined, active: boolean) {
      edges.push({
        id: source + '-' + target,
        source,
        target,
        label,
        className: active ? 'workflow-edge--matched' : '',
        animated: false,
      });
    }
    function visit(id: number, column: number, visited: Set<number>): number {
      const node = draft.nodes[id];
      if (!node || visited.has(id)) return nextRow;
      visited.add(id);
      if (node.type === 'condition') {
        const yesRow = visit(node.yes, column + 1, visited);
        const noRow = visit(node.no, column + 1, visited);
        const row = (yesRow + noRow) / 2;
        box(
          String(id),
          id,
          conditionText(draft, node),
          'Choose one path',
          column,
          row,
          'Condition',
        );
        connect(String(id), String(node.yes), 'Yes', highlight.has(node.yes));
        connect(String(id), String(node.no), 'Otherwise', highlight.has(node.no));
        return row;
      }
      const row = nextRow++;
      if (!node.actions.length) box(String(id), id, 'Do nothing', '', column, row, 'Path');
      node.actions.forEach((action, index) => {
        const actionId = index === 0 ? String(id) : id + '-step-' + index;
        box(
          actionId,
          id,
          workflowActionLabels[action.kind],
          action.kind === 'alert' ? '' : stepText(action),
          column + index,
          row,
          'Step ' + (index + 1),
        );
        if (index > 0)
          connect(
            index === 1 ? String(id) : id + '-step-' + (index - 1),
            actionId,
            undefined,
            highlight.has(id),
          );
      });
      return row;
    }
    const row = visit(0, 1, new Set());
    box('trigger', 'trigger', workflowTriggerText(draft), '', 0, row, 'Trigger');
    connect('trigger', '0', undefined, leaf !== undefined);
    return { nodes, edges };
  }, [draft, selected, select, leaf]);

  return (
    <div className="workflow-canvas" aria-label="Workflow diagram">
      <ReactFlow
        key={nodes.length}
        className="dark"
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.12}
        maxZoom={1.7}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        panOnScroll={false}
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => select?.(node.data.owner as GraphSelection)}
        onNodeDoubleClick={(_, node) => select?.(node.data.owner as GraphSelection)}
        onSelectionChange={({ nodes: focused }) => {
          if (focused.length === 1 && focused[0]) {
            const owner = focused[0].data.owner as GraphSelection;
            if (owner !== selected) select?.(owner);
          }
        }}
      >
        <Background gap={22} size={1} color="var(--rb-border)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

export function WorkflowOutline({
  draft,
  select,
  selected,
  leaf,
}: {
  draft: WorkflowDraft;
  select?: (selection: GraphSelection) => void;
  selected?: GraphSelection;
  leaf?: number;
}) {
  const highlight = highlightedPath(draft, leaf);
  function branch(id: number, depth: number) {
    const node = draft.nodes[id];
    if (!node || depth > 3) return null;
    return (
      <li className={highlight.has(id) ? 'workflow-outline-match' : undefined}>
        {select ? (
          <button
            type="button"
            className="workflow-outline-button"
            aria-pressed={selected === id}
            onClick={() => select(id)}
          >
            {node.type === 'condition'
              ? conditionText(draft, node)
              : node.actions.length
                ? 'Edit steps'
                : 'Do nothing'}
          </button>
        ) : (
          <strong>
            {node.type === 'condition'
              ? conditionText(draft, node)
              : node.actions.length
                ? 'Run these steps'
                : 'Do nothing'}
          </strong>
        )}
        {node.type === 'condition' ? (
          <ul className="workflow-branch-list">
            <li>
              <span>Yes</span>
              <ul>{branch(node.yes, depth + 1)}</ul>
            </li>
            <li>
              <span>Otherwise</span>
              <ul>{branch(node.no, depth + 1)}</ul>
            </li>
          </ul>
        ) : (
          node.actions.length > 0 && (
            <ol>
              {node.actions.map((action, index) => (
                <li key={index}>{stepText(action)}</li>
              ))}
            </ol>
          )
        )}
      </li>
    );
  }

  return (
    <div className="workflow-outline">
      {select ? (
        <button
          type="button"
          className="workflow-outline-button"
          aria-pressed={selected === 'trigger'}
          onClick={() => select('trigger')}
        >
          {workflowTriggerText(draft)}
        </button>
      ) : (
        <strong>{workflowTriggerText(draft)}</strong>
      )}
      <ul>{branch(0, 0)}</ul>
    </div>
  );
}
