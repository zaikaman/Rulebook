import {
  ArrowUpRight01Icon,
  Exchange01Icon,
  FlashIcon,
  GitBranchIcon,
  MinusSignIcon,
  Notification01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useViewport,
  type BuiltInEdge,
  type Dimensions,
  type FitViewOptions,
  type Node,
  type NodeProps,
  type XYPosition,
} from '@xyflow/react';
import { useMemo, useState } from 'react';
import { workflowActionLabels, type WorkflowDraft } from '@rulebook/shared';
import { conditionText, stepAmountText, stepText, workflowTriggerText } from './model';
import {
  branchPathKey,
  isLibraryNode,
  isTriggerNode,
  placementProblem,
  stepPathKey,
  workflowNodeMime,
  workflowRootKey,
  type LibraryNode,
  type LibraryTarget,
} from './nodeLibraryModel';
import '@xyflow/react/dist/style.css';

export type GraphSelection = 'trigger' | number;
export type WorkflowNodePositions = Record<string, XYPosition>;

export type CanvasNode =
  | { title: string; yes: number; no: number }
  | {
      actions: {
        kind: 'send' | 'swap' | 'alert';
        title: string;
        detail?: string;
        description?: string;
      }[];
    };

export type CanvasDraft = { trigger: string; nodes: readonly CanvasNode[] };

const nodeIcons = {
  trigger: FlashIcon,
  condition: GitBranchIcon,
  send: ArrowUpRight01Icon,
  swap: Exchange01Icon,
  alert: Notification01Icon,
  skip: MinusSignIcon,
};

type WorkflowNodeCard = Node<
  {
    owner: GraphSelection;
    kind: keyof typeof nodeIcons;
    caption: string;
    title: string;
    detail?: string;
    step?: number;
    description?: string;
    continues: boolean;
    matched: boolean;
  },
  'workflow'
>;

const fitOptions = {
  padding: { top: '24px', bottom: '64px', x: '24px' },
  maxZoom: 1.05,
} satisfies FitViewOptions;

function WorkflowDiagramNode({ data }: NodeProps<WorkflowNodeCard>) {
  return (
    <div
      className="workflow-node-card"
      data-kind={data.kind}
      data-matched={data.matched || undefined}
    >
      {data.kind !== 'trigger' && (
        <Handle type="target" position={Position.Top} isConnectable={false} />
      )}
      <span className="workflow-node-icon" aria-hidden="true">
        <HugeiconsIcon icon={nodeIcons[data.kind]} size={18} />
      </span>
      <div className="workflow-node-copy">
        <span className="workflow-node-kind">{data.caption}</span>
        <strong className="workflow-node-title" title={data.title}>
          {data.title}
        </strong>
        {data.detail && (
          <span className="workflow-node-detail" title={data.description ?? data.detail}>
            {data.detail}
          </span>
        )}
      </div>
      {data.continues && <Handle type="source" position={Position.Bottom} isConnectable={false} />}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowDiagramNode };

function measurementKey(node: WorkflowNodeCard) {
  return `${node.id}:${node.data.kind}:${node.data.continues}`;
}

function ZoomReadout() {
  const { zoom } = useViewport();
  return <span className="workflow-canvas-zoom">{Math.round(zoom * 100)}%</span>;
}

function highlightedPath(
  nodes: CanvasDraft['nodes'] | WorkflowDraft['nodes'],
  leaf: number | undefined,
) {
  const path = new Set<number>();
  if (leaf === undefined) return path;
  function find(id: number): boolean {
    const node = nodes[id];
    if (!node) return false;
    if (id === leaf || ('yes' in node && (find(node.yes) || find(node.no)))) {
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
  positions,
  onPositionsChange,
  draggedTool,
  onToolDrop,
}: {
  draft: WorkflowDraft;
  selected?: GraphSelection;
  select?: (selection: GraphSelection) => void;
  leaf?: number;
  positions?: WorkflowNodePositions;
  onPositionsChange?: (positions: WorkflowNodePositions) => void;
  draggedTool?: LibraryNode | null;
  onToolDrop?: (kind: LibraryNode, target?: LibraryTarget) => void;
}) {
  const canvas = useMemo<CanvasDraft>(
    () => ({
      trigger: workflowTriggerText(draft),
      nodes: draft.nodes.map((node) =>
        node.type === 'condition'
          ? { title: conditionText(draft, node), yes: node.yes, no: node.no }
          : {
              actions: node.actions.map((action) => ({
                kind: action.kind,
                title: workflowActionLabels[action.kind],
                detail: action.kind === 'alert' ? undefined : stepAmountText(action),
                description: action.kind === 'alert' ? undefined : stepText(action),
              })),
            },
      ),
    }),
    [draft],
  );
  return (
    <WorkflowCanvas
      draft={canvas}
      {...{ selected, select, leaf, positions, onPositionsChange }}
      drop={
        onToolDrop
          ? {
              mime: workflowNodeMime,
              active: Boolean(draggedTool),
              hint:
                draggedTool &&
                (isTriggerNode(draggedTool)
                  ? 'Drop on the trigger to replace it'
                  : draggedTool === 'condition'
                    ? 'Drop on a highlighted node to branch before it'
                    : 'Drop on an empty path or an existing step'),
              accepts: (target) =>
                Boolean(draggedTool && !placementProblem(draft, draggedTool, target)),
              receive: (tool, target) => {
                if (isLibraryNode(tool)) onToolDrop(tool, target);
              },
            }
          : undefined
      }
    />
  );
}

type CanvasDrop = {
  mime: string;
  active: boolean;
  hint?: string | null;
  accepts: (target: LibraryTarget) => boolean;
  receive: (tool: string, target?: LibraryTarget) => void;
};

export function WorkflowCanvas({
  draft,
  selected,
  select,
  leaf,
  positions,
  onPositionsChange,
  onPaneClick,
  fitViewOptions = fitOptions,
  drop,
}: {
  draft: CanvasDraft;
  selected?: GraphSelection;
  select?: (selection: GraphSelection, step?: number) => void;
  leaf?: number;
  positions?: WorkflowNodePositions;
  onPositionsChange?: (positions: WorkflowNodePositions) => void;
  onPaneClick?: () => void;
  fitViewOptions?: FitViewOptions;
  drop?: CanvasDrop;
}) {
  const editable = Boolean(select);
  const [measurements, setMeasurements] = useState<Record<string, Dimensions>>({});
  const [dragPositions, setDragPositions] = useState<WorkflowNodePositions>({});
  const [activeNodeId, setActiveNodeId] = useState<string>();
  const { nodes, edges } = useMemo(() => {
    const nodes: WorkflowNodeCard[] = [];
    const edges: BuiltInEdge[] = [];
    const highlight = highlightedPath(draft.nodes, leaf);
    let nextRow = 0;
    function box(
      id: string,
      data: Omit<WorkflowNodeCard['data'], 'matched'>,
      stage: number,
      row: number,
    ) {
      const { owner, caption, title, description } = data;
      const matched = owner === 'trigger' ? leaf !== undefined : highlight.has(owner);
      nodes.push({
        id,
        type: 'workflow',
        position: { x: row * 248, y: stage * 122 },
        connectable: false,
        selectable: editable,
        focusable: editable,
        data: { ...data, matched },
        className: 'workflow-node',
        ariaRole: editable ? 'button' : undefined,
        ariaLabel: [caption, title, description].filter(Boolean).join('. '),
      });
    }
    function connect(
      source: string,
      target: string,
      branch: 'yes' | 'otherwise' | undefined,
      active: boolean,
    ) {
      edges.push({
        id: source + '-' + target,
        source,
        target,
        type: 'smoothstep',
        pathOptions: { borderRadius: 10, offset: 12 },
        label: branch === 'yes' ? 'Yes' : branch === 'otherwise' ? 'Otherwise' : undefined,
        labelBgPadding: [7, 4],
        labelBgBorderRadius: 5,
        className: [branch && 'workflow-edge--' + branch, active && 'workflow-edge--matched']
          .filter(Boolean)
          .join(' '),
        selectable: false,
      });
    }
    // Branch paths stay stable even when the program compacts its numeric node IDs.
    function visit(id: number, path: string, column: number, visited: Set<number>): number {
      const node = draft.nodes[id];
      if (!node || visited.has(id)) return nextRow;
      visited.add(id);
      if ('yes' in node) {
        const yes = branchPathKey(path, 'yes');
        const no = branchPathKey(path, 'otherwise');
        const yesRow = visit(node.yes, yes, column + 1, visited);
        const noRow = visit(node.no, no, column + 1, visited);
        const row = (yesRow + noRow) / 2;
        box(
          path,
          {
            owner: id,
            kind: 'condition',
            caption: 'Condition',
            title: node.title,
            continues: true,
          },
          column,
          row,
        );
        connect(path, yes, 'yes', highlight.has(node.yes));
        connect(path, no, 'otherwise', highlight.has(node.no));
        return row;
      }
      const row = nextRow++;
      if (!node.actions.length)
        box(
          path,
          { owner: id, kind: 'skip', caption: 'Skip', title: 'Do nothing', continues: false },
          column,
          row,
        );
      node.actions.forEach((action, index) => {
        const actionId = stepPathKey(path, index);
        box(
          actionId,
          {
            owner: id,
            kind: action.kind,
            step: index,
            caption: 'Step ' + (index + 1),
            title: action.title,
            detail: action.detail,
            description: action.description,
            continues: index + 1 < node.actions.length,
          },
          column + index,
          row,
        );
        if (index > 0)
          connect(stepPathKey(path, index - 1), actionId, undefined, highlight.has(id));
      });
      return row;
    }
    const row = visit(0, workflowRootKey, 1, new Set());
    box(
      'trigger',
      {
        owner: 'trigger',
        kind: 'trigger',
        caption: 'Trigger',
        title: draft.trigger,
        continues: true,
      },
      0,
      row,
    );
    connect('trigger', workflowRootKey, undefined, leaf !== undefined);
    nodes.sort(
      (left, right) => left.position.y - right.position.y || left.position.x - right.position.x,
    );
    return { nodes, edges };
  }, [draft, editable, leaf]);

  const laidOutNodes = useMemo(() => {
    const activeNode =
      nodes.find((node) => node.id === activeNodeId && node.data.owner === selected) ??
      nodes.find((node) => node.data.owner === selected);
    return nodes.map((node) => {
      const placement = { owner: node.data.owner, afterStep: node.data.step };
      const acceptsTool = drop?.accepts(placement);
      return {
        ...node,
        position: positions?.[node.id] ?? node.position,
        measured: measurements[measurementKey(node)],
        selected: node.id === activeNode?.id,
        className: acceptsTool ? 'workflow-node workflow-node--drop-target' : node.className,
        domAttributes: editable ? { 'aria-pressed': node.id === activeNode?.id } : undefined,
      };
    });
  }, [nodes, activeNodeId, selected, measurements, positions, editable, drop]);

  const positionedNodes = useMemo(
    () =>
      laidOutNodes.map((node) => {
        const position = dragPositions[node.id];
        return position ? { ...node, position, dragging: true } : node;
      }),
    [laidOutNodes, dragPositions],
  );

  function chooseNode(node: WorkflowNodeCard) {
    setActiveNodeId(node.id);
    select?.(node.data.owner, node.data.step);
  }

  return (
    <div
      className="workflow-canvas"
      aria-label="Workflow diagram"
      onDragOver={
        drop
          ? (event) => {
              if (!event.dataTransfer.types.includes(drop.mime)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          : undefined
      }
      onDrop={
        drop
          ? (event) => {
              const kind = event.dataTransfer.getData(drop.mime);
              if (!kind) return;
              event.preventDefault();
              const id =
                event.target instanceof Element
                  ? event.target.closest<HTMLElement>('.workflow-node')?.dataset.id
                  : undefined;
              const node = nodes.find((item) => item.id === id);
              drop.receive(kind, node && { owner: node.data.owner, afterStep: node.data.step });
            }
          : undefined
      }
    >
      <ReactFlow
        key={nodes.length}
        className="dark"
        nodes={positionedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.12}
        maxZoom={1.7}
        nodesDraggable={Boolean(onPositionsChange)}
        selectNodesOnDrag={false}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        panOnScroll={false}
        zoomOnScroll={editable}
        preventScrolling={editable}
        proOptions={{ hideAttribution: true }}
        onNodeClick={editable ? (_, node) => chooseNode(node) : undefined}
        onPaneClick={onPaneClick}
        onNodesChange={(changes) => {
          // Controlled node updates must retain React Flow's sizes and handle bounds.
          const measured = changes.getByType('dimensions');
          if (measured.length) {
            setMeasurements((current) => {
              const next = { ...current };
              for (const { id, dimensions } of measured) {
                const node = nodes.find((item) => item.id === id);
                if (node && dimensions) next[measurementKey(node)] = dimensions;
              }
              return next;
            });
          }
          const active = changes.getByType('select').find((change) => change.selected);
          const node = active && nodes.find((item) => item.id === active.id);
          if (node) chooseNode(node);
          if (!onPositionsChange) return;

          const moving: WorkflowNodePositions = {};
          const settled: WorkflowNodePositions = {};
          for (const { id, position, dragging } of changes.getByType('position')) {
            if (position) (dragging ? moving : settled)[id] = position;
          }
          if (Object.keys(moving).length) setDragPositions(moving);
          if (Object.keys(settled).length) {
            setDragPositions({});
            onPositionsChange(settled);
          }
        }}
      >
        <Background gap={20} size={1.35} color="var(--workflow-grid-dot)" />
        <Controls
          aria-label="Canvas zoom controls"
          orientation="horizontal"
          showInteractive={false}
          position="bottom-right"
          fitViewOptions={fitViewOptions}
          className="workflow-canvas-dock"
        >
          <ZoomReadout />
        </Controls>
      </ReactFlow>
      {editable && (
        <p className="workflow-canvas-hint" data-drop-active={drop?.active || undefined}>
          {drop?.hint || 'Drag nodes to move · Scroll to zoom'}
        </p>
      )}
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
  const highlight = highlightedPath(draft.nodes, leaf);
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
