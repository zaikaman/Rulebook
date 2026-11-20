import {
  createWorkflowV2Recipe,
  decodeWorkflowV2,
  encodeWorkflowV2,
  workflowIdSchema,
  workflowLimits,
  workflowV2Action as A,
  workflowV2Check as C,
  workflowV2Recipes,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type WorkflowV2Program,
  type WorkflowV2RecipeId,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { bytesToHex, type Hex } from 'viem';
import { useAccount } from 'wagmi';
import { z } from 'zod';

import { PageHeading } from '@/components/chrome/PageHeading';
import { WalletControl } from '@/components/chrome/WalletControl';
import { WorkflowCanvas, type GraphSelection, type WorkflowNodePositions } from './Graph';
import { diagramV2, replacePath } from './diagramV2';
import { copyListingDraft, getV2Listing, v2ListingId } from './listingV2';
import { branchPathKey, workflowRootKey, type LibraryTarget } from './nodeLibraryModel';
import {
  formatWorkflowCaps,
  workflowActivationEnabled,
  readWorkflowV2,
  settlementFactory,
  useWorkflowV2Wallet,
  validateV2Program,
  v2Explorer,
  v2Network,
} from './chainV2';
import {
  actions,
  checks,
  emptyDraft,
  emptyPath,
  recipeFields,
  recipeLabels,
  toDraft,
  toProgram,
  triggers,
  unavailable,
  v2DraftSchema,
  type DraftPath,
  type NodeTool,
  type V2Draft,
} from './modelV2';

const nodeMime = 'application/x-rulebook-v2-workflow-node';
const nodeGroups = ['Triggers', 'Checks', 'Actions', 'Notifications'] as const;
const tools: NodeTool[] = [
  { group: 'trigger', code: T.schedule },
  { group: 'trigger', code: T.payment },
  { group: 'trigger', code: T.price },
  { group: 'trigger', code: T.transfer },
  ...Object.values(C).map((code) => ({ group: 'check' as const, code })),
  ...Object.values(A).map((code) => ({ group: 'action' as const, code })),
];

function toolLabel(tool: NodeTool) {
  if (tool.group === 'trigger') return triggers[tool.code];
  return tool.group === 'check' ? checks[tool.code].name : actions[tool.code].name;
}

export function V2Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="app-field">
      <span>{name}</span>
      {children}
    </label>
  );
}

function Input({
  name,
  value,
  change,
  text = false,
}: {
  name: string;
  value: string;
  change: (value: string) => void;
  text?: boolean;
}) {
  return (
    <V2Field name={name}>
      <input
        className="app-input"
        value={value}
        inputMode={text ? 'text' : 'decimal'}
        onChange={(event) => change(event.target.value)}
      />
    </V2Field>
  );
}

export function V2Feedback({ wallet }: { wallet: ReturnType<typeof useWorkflowV2Wallet> }) {
  return (
    <div className="workflow-feedback" aria-live="polite">
      {wallet.status && <p>{wallet.status}</p>}
      {wallet.error && (
        <p className="workflow-error" role="alert">
          {wallet.error}
        </p>
      )}
      {wallet.transaction && (
        <a
          className="app-link"
          href={v2Explorer(wallet.transaction.chain, wallet.transaction.hash)}
          target="_blank"
          rel="noreferrer"
        >
          Latest transaction on {v2Network(wallet.transaction.chain).name}
        </a>
      )}
    </div>
  );
}

function RecipePicker({
  initialRecipe,
  open,
  close,
}: {
  initialRecipe?: WorkflowV2RecipeId;
  open: (draft: V2Draft) => void;
  close: () => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All categories');
  const [selected, select] = useState<WorkflowV2RecipeId | undefined>(initialRecipe);
  const [values, setValues] = useState<Record<string, string>>({ direction: 'rising' });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string>();
  const recipe = workflowV2Recipes.find((item) => item.id === selected);
  const visible = workflowV2Recipes.filter(
    (item) =>
      (category === 'All categories' || item.category === category) &&
      `${item.title} ${item.category}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function useRecipe(event: FormEvent) {
    event.preventDefault();
    if (!recipe) return;
    try {
      const program = createWorkflowV2Recipe(recipe.id, values, { inactivityPayout: consent });
      open(toDraft(program, recipe.title));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the recipe settings.');
    }
  }

  return (
    <section className="workflow-v2-columns" aria-label="Workflow recipes">
      <div className="app-panel app-panel-pad workflow-v2-stack">
        <div className="workflow-actions">
          <h2 className="app-panel-heading">Recipes</h2>
          <button type="button" className="app-button" onClick={close}>
            Start from scratch
          </button>
        </div>
        <Input name="Search recipes" value={search} change={setSearch} text />
        <V2Field name="Category">
          <select
            className="app-input"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {['All categories', 'Trading', 'Payments', 'Wallet safety'].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </V2Field>
        <ul className="workflow-v2-recipe-list">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                className="workflow-workspace-row"
                type="button"
                aria-pressed={item.id === selected}
                onClick={() => {
                  select(item.id);
                  setValues({ direction: 'rising' });
                  setConsent(false);
                  setError(undefined);
                }}
              >
                <strong>{item.title}</strong>
                <span>
                  {item.category} · {v2Network(item.chain).name}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!visible.length && <p className="app-copy">No recipes match your search.</p>}
      </div>
      {recipe && (
        <form className="app-panel app-panel-pad workflow-v2-stack" onSubmit={useRecipe}>
          <h2 className="app-panel-heading">{recipe.title}</h2>
          <p className="app-copy">{v2Network(recipe.chain).name}</p>
          {recipeFields[recipe.id].map((field) =>
            field === 'direction' ? (
              <V2Field key={field} name="Alert when the price is">
                <select
                  className="app-input"
                  value={values.direction}
                  onChange={(event) => setValues({ ...values, direction: event.target.value })}
                >
                  <option value="rising">At or above target</option>
                  <option value="falling">At or below target</option>
                </select>
              </V2Field>
            ) : (
              <Input
                key={field}
                name={recipeLabels[field] ?? field}
                value={values[field] ?? ''}
                text={/recipient|address/i.test(recipeLabels[field] ?? '')}
                change={(value) => setValues({ ...values, [field]: value })}
              />
            ),
          )}
          {recipe.id === 'inactivity-payout' && (
            <label className="workflow-v2-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I authorize one fixed payout after a 24-hour grace period.
            </label>
          )}
          {error && (
            <p className="workflow-error" role="alert">
              {error}
            </p>
          )}
          <button className="app-button app-button--primary" type="submit">
            Open in builder
          </button>
        </form>
      )}
    </section>
  );
}

function PathEditor({
  anchor,
  path,
  change,
  depth,
  draft,
  selected,
  place,
}: {
  anchor: string;
  path: DraftPath;
  change: (path: DraftPath) => void;
  depth: number;
  draft: V2Draft;
  selected?: NodeTool;
  place: (
    tool: NodeTool,
    leaf: Extract<DraftPath, { steps: unknown }>,
    change: (path: DraftPath) => void,
    depth: number,
  ) => void;
}) {
  if ('check' in path) {
    const metadata = checks[path.check];
    return (
      <div
        className="workflow-v2-path workflow-v2-stack"
        data-branch="condition"
        id={`edit-${anchor}`}
        tabIndex={-1}
      >
        <div className="workflow-actions">
          <strong>{metadata.name}</strong>
          <button className="workflow-text-button" type="button" onClick={() => change(path.yes)}>
            Keep Yes path only
          </button>
        </div>
        {metadata.decimals !== undefined && (
          <Input
            name={`${metadata.name} threshold`}
            value={path.value}
            change={(value) => change({ ...path, value })}
          />
        )}
        {metadata.upper && (
          <Input
            name={metadata.upper}
            value={path.upper}
            change={(upper) => change({ ...path, upper })}
          />
        )}
        <div className="workflow-v2-branches">
          <section aria-label="Yes path">
            <h3>Yes</h3>
            <PathEditor
              anchor={branchPathKey(anchor, 'yes')}
              {...{ draft, selected, place }}
              path={path.yes}
              change={(yes) => change({ ...path, yes })}
              depth={depth + 1}
            />
          </section>
          <section aria-label="Otherwise path">
            <h3>Otherwise</h3>
            <PathEditor
              anchor={branchPathKey(anchor, 'otherwise')}
              {...{ draft, selected, place }}
              path={path.no}
              change={(no) => change({ ...path, no })}
              depth={depth + 1}
            />
          </section>
        </div>
      </div>
    );
  }
  return (
    <div
      className="workflow-v2-path workflow-v2-stack"
      id={`edit-${anchor}`}
      tabIndex={-1}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(nodeMime)) event.preventDefault();
      }}
      onDrop={(event) => {
        const tool = tools.find(
          (item) => `${item.group}:${item.code}` === event.dataTransfer.getData(nodeMime),
        );
        if (!tool) return;
        event.preventDefault();
        event.stopPropagation();
        place(tool, path, change, depth);
      }}
    >
      {path.steps.map((step, index) => {
        const metadata = actions[step.kind];
        const update = (next: typeof step) =>
          change({ steps: path.steps.map((current, i) => (i === index ? next : current)) });
        return (
          <div key={index} className="workflow-v2-step workflow-v2-stack">
            <strong>{metadata.name}</strong>
            {metadata.asset && (
              <>
                {draft.trigger === T.payment && (step.kind === A.send || step.kind === A.buy) && (
                  <V2Field name="Amount type">
                    <select
                      className="app-input"
                      value={step.unit}
                      onChange={(event) =>
                        update({
                          ...step,
                          unit: event.target.value === '1' ? U.percent : U.fixed,
                          amount: '',
                        })
                      }
                    >
                      <option value={U.fixed}>Fixed {metadata.asset}</option>
                      <option value={U.percent}>Percent of payment</option>
                    </select>
                  </V2Field>
                )}
                <Input
                  name={
                    step.unit === U.percent ? 'Percent of payment' : `Amount in ${metadata.asset}`
                  }
                  value={step.amount}
                  change={(amount) => update({ ...step, amount })}
                />
              </>
            )}
            {metadata.recipient && (
              <Input
                name="Recipient address"
                value={step.recipient}
                change={(recipient) => update({ ...step, recipient })}
                text
              />
            )}
            <div className="workflow-actions">
              {index > 0 && (
                <button
                  type="button"
                  className="workflow-text-button"
                  onClick={() => {
                    const steps = path.steps.slice();
                    const previous = steps[index - 1];
                    if (!previous) return;
                    steps[index - 1] = step;
                    steps[index] = previous;
                    change({ steps });
                  }}
                >
                  Move earlier
                </button>
              )}
              <button
                type="button"
                className="workflow-text-button"
                onClick={() => change({ steps: path.steps.filter((_, i) => i !== index) })}
              >
                Remove {metadata.name.toLowerCase()}
              </button>
            </div>
          </div>
        );
      })}
      {selected && selected.group !== 'trigger' ? (
        <button
          type="button"
          className="app-button"
          onClick={() => place(selected, path, change, depth)}
        >
          Add {toolLabel(selected)} here
        </button>
      ) : (
        <p className="app-copy">
          {path.steps.length
            ? 'Drop a node here to add to this path.'
            : 'This path skips the run until you add a step.'}
        </p>
      )}
    </div>
  );
}

export function WorkflowProgramSummary({ draft }: { draft: V2Draft }) {
  function show(path: DraftPath): ReactNode {
    if ('steps' in path)
      return path.steps.length ? (
        <ol>
          {path.steps.map((step, index) => (
            <li key={index}>
              {actions[step.kind].name}
              {step.amount &&
                ` · ${step.amount} ${step.unit === U.percent ? '% of payment' : actions[step.kind].asset}`}
              {step.recipient && (
                <>
                  {' '}
                  · <span className="workflow-v2-address">{step.recipient}</span>
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>Skip the run.</p>
      );
    return (
      <div className="workflow-v2-path">
        <strong>
          {checks[path.check].name} {path.value}
          {path.upper && ` to ${path.upper}`}
        </strong>
        <div className="workflow-v2-branches">
          <div>
            <h3>Yes</h3>
            {show(path.yes)}
          </div>
          <div>
            <h3>Otherwise</h3>
            {show(path.no)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="workflow-v2-stack">
      <dl className="workflow-v2-summary">
        <div>
          <dt>Settlement network</dt>
          <dd>{v2Network(draft.chain).name}</dd>
        </div>
        <div>
          <dt>Trigger</dt>
          <dd>
            {triggers[draft.trigger]}
            {draft.trigger === T.schedule && ` every ${draft.interval} seconds`}
          </dd>
        </div>
        <div>
          <dt>Per-run limits</dt>
          <dd>
            {draft.usdcCap || '0'} USDC · {draft.wethCap || '0'} WETH
          </dd>
        </div>
        {Number(draft.slippage) > 0 && (
          <div>
            <dt>Maximum swap slippage</dt>
            <dd>{draft.slippage}%</dd>
          </div>
        )}
        {draft.source && (
          <div>
            <dt>Token contract</dt>
            <dd className="workflow-v2-address">{draft.source}</dd>
          </div>
        )}
        {draft.subject && (
          <div>
            <dt>Account or protocol</dt>
            <dd className="workflow-v2-address">{draft.subject}</dd>
          </div>
        )}
        {draft.expires && (
          <div>
            <dt>Expires</dt>
            <dd>{new Date(Number(draft.expires) * 1000).toLocaleString()}</dd>
          </div>
        )}
        {draft.once && (
          <div>
            <dt>After confirmation</dt>
            <dd>Close this workflow</dd>
          </div>
        )}
      </dl>
      {show(draft.root)}
    </div>
  );
}

export function WorkflowBuilderV2() {
  const { address } = useAccount();
  const [params] = useSearchParams();
  const { id: raw } = useParams();
  const id = workflowIdSchema.safeParse(raw);
  const copy = params.get('copy');
  const copyId = v2ListingId.safeParse(copy);
  const savedCopy = copyId.success ? loadDraft(`rulebook-v2-draft:${copyId.data}`) : undefined;
  const query = useQuery({
    queryKey: ['workflow-v2', 'edit', address, raw],
    enabled: Boolean(id.success && address),
    queryFn: () => readWorkflowV2(address!, id.data!),
  });
  const listing = useQuery({
    queryKey: ['workflow-v2', 'listing', copy],
    enabled: !raw && copyId.success && !savedCopy,
    queryFn: ({ signal }) => getV2Listing(copyId.data!, signal),
  });
  if (raw && !id.success) return <p role="alert">This workflow link is invalid.</p>;
  if (raw && !address)
    return (
      <section className="app-page">
        <PageHeading title="Edit workflow" />
        <WalletControl setup />
      </section>
    );
  if (raw && query.isPending) return <p role="status">Reading your workflow…</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (copy && !copyId.success) return <p role="alert">This listing link is invalid.</p>;
  if (!raw && copy && !savedCopy && listing.isPending)
    return <p role="status">Preparing your copy…</p>;
  if (listing.error && !savedCopy) return <p role="alert">{listing.error.message}</p>;
  const recipe = workflowV2Recipes.find((item) => item.id === params.get('recipe'))?.id;
  return (
    <Editor
      key={`${raw ? address : 'new'}:${raw ?? 'new'}:${copy ?? recipe ?? ''}`}
      id={id.data}
      storageKey={`rulebook-v2-draft:${raw ?? copy ?? recipe ?? 'new'}`}
      original={
        query.data
          ? toDraft(decodeWorkflowV2(query.data.program), query.data.title)
          : listing.data
            ? copyListingDraft(listing.data)
            : undefined
      }
      recipe={recipe}
    />
  );
}

const savedDraft = z.object({
  id: workflowIdSchema,
  draft: v2DraftSchema,
  positions: z.record(z.object({ x: z.number().finite(), y: z.number().finite() })),
});

function loadDraft(storageKey: string) {
  try {
    const json = localStorage.getItem(storageKey);
    return json ? savedDraft.parse(JSON.parse(json)) : undefined;
  } catch {
    return undefined;
  }
}

function Editor({
  id,
  original,
  recipe,
  storageKey,
}: {
  id?: Hex;
  original?: V2Draft;
  recipe?: WorkflowV2RecipeId;
  storageKey: string;
}) {
  const wallet = useWorkflowV2Wallet();
  const navigate = useNavigate();
  const [saved] = useState(() => loadDraft(storageKey));
  const [draft, setDraft] = useState<V2Draft>(() => saved?.draft ?? original ?? emptyDraft());
  const diagram = useMemo(() => diagramV2(draft), [draft]);
  const [nodeGroup, setNodeGroup] = useState<(typeof nodeGroups)[number]>('Triggers');
  const [canvasSelection, setCanvasSelection] = useState<GraphSelection>('trigger');
  const [positions, setPositions] = useState<WorkflowNodePositions>(saved?.positions ?? {});
  const [dragged, setDragged] = useState<NodeTool>();
  const [workflowId] = useState(
    () => id ?? saved?.id ?? bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
  );
  const [recipes, setRecipes] = useState(!original && !saved);
  const [selected, pick] = useState<NodeTool>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [program, review] = useState<WorkflowV2Program>();
  const [consent, setConsent] = useState(false);
  const [validating, setValidating] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    if (recipes) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ id: workflowId, draft, positions }));
    } catch {
      /* The current draft remains available in this tab. */
    }
  }, [storageKey, workflowId, draft, positions, recipes]);
  function update(fields: Partial<V2Draft>) {
    revision.current += 1;
    setDraft((current) => ({ ...current, ...fields }));
    setError(undefined);
    review(undefined);
    setConsent(false);
  }

  function place(
    tool: NodeTool,
    leaf: Extract<DraftPath, { steps: unknown }>,
    change: (path: DraftPath) => void,
    depth: number,
    afterStep?: number,
  ) {
    const problem = unavailable(tool, draft);
    if (problem) {
      setError(problem);
      return;
    }
    if (tool.group === 'trigger') {
      update({ trigger: tool.code });
      return;
    }
    if (tool.group === 'check') {
      if (depth >= workflowLimits.conditionDepth) {
        setError('A path can have up to three checks.');
        return;
      }
      change({ check: tool.code, value: '', upper: '', yes: leaf, no: emptyPath() });
    } else {
      if (leaf.steps.length >= workflowLimits.stepsPerPath) {
        setError('A path can have up to three actions.');
        return;
      }
      const steps = leaf.steps.slice();
      steps.splice(afterStep === undefined ? steps.length : afterStep + 1, 0, {
        kind: tool.code,
        unit: U.fixed,
        amount: '',
        recipient: '',
      });
      change({ steps });
    }
    pick(undefined);
    setStatus(`${toolLabel(tool)} added.`);
  }

  function accepts(tool: NodeTool, target: LibraryTarget) {
    if (unavailable(tool, draft)) return false;
    if (tool.group === 'trigger') return target.owner === 'trigger';
    if (target.owner === 'trigger') return false;
    const branch = diagram.paths[target.owner];
    if (!branch || !('steps' in branch.path)) return false;
    return tool.group === 'check'
      ? branch.depth < workflowLimits.conditionDepth &&
          (target.afterStep === undefined || target.afterStep === 0)
      : branch.path.steps.length < workflowLimits.stepsPerPath;
  }

  function drop(value: string, target?: LibraryTarget) {
    const tool = tools.find((item) => `${item.group}:${item.code}` === value);
    setDragged(undefined);
    if (!tool) return;
    if (!target || !accepts(tool, target)) {
      setError('Drop this node on a highlighted part of the canvas.');
      return;
    }
    if (tool.group === 'trigger') {
      update({ trigger: tool.code });
      return;
    }
    if (target.owner === 'trigger') return;
    const match = diagram.paths[target.owner];
    if (!match || !('steps' in match.path)) return;
    setCanvasSelection(target.owner);
    place(
      tool,
      match.path,
      (path) => update({ root: replacePath(draft.root, match.path, path) }),
      match.depth,
      target.afterStep,
    );
  }

  function focusSettings() {
    const anchor =
      canvasSelection === 'trigger' ? 'trigger' : diagram.paths[canvasSelection]?.anchor;
    if (!anchor) return;
    const target = document.getElementById(`edit-${anchor}`);
    target?.scrollIntoView({ block: 'nearest' });
    target?.focus({ preventScroll: true });
  }

  async function prepare() {
    const current = revision.current;
    setValidating(true);
    try {
      const next = toProgram(draft);
      await validateV2Program(encodeWorkflowV2(next));
      if (current !== revision.current) return;
      review(next);
      setStatus(undefined);
      setError(undefined);
    } catch (cause) {
      if (current === revision.current)
        setError(
          cause instanceof Error ? cause.message.split('\n')[0] : 'Check the workflow settings.',
        );
    } finally {
      setValidating(false);
    }
  }

  const spendKinds = program?.nodes.flatMap((node) => node.actions.map((step) => step.kind)) ?? [];
  const hasPayout = spendKinds.includes(A.inactivityPayout);
  return (
    <section className="app-page workflow-page workflow-v2-stack">
      <PageHeading
        title={id ? 'Edit workflow' : 'Build a workflow'}
        description="Choose a testnet recipe or build a workflow from triggers, checks, actions, and notifications."
      />
      {recipes ? (
        <RecipePicker
          initialRecipe={recipe}
          close={() => setRecipes(false)}
          open={(next) => {
            setDraft(next);
            setPositions({});
            setCanvasSelection('trigger');
            setRecipes(false);
          }}
        />
      ) : program ? (
        <section className="app-panel app-panel-pad workflow-v2-stack">
          <h2 className="app-panel-heading">Review {draft.title.trim()}</h2>
          <WorkflowProgramSummary draft={draft} />
          {hasPayout && (
            <label className="workflow-v2-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              Authorize the fixed payout after the 24-hour grace period.
            </label>
          )}
          <p className="app-copy">
            Review the {v2Network(draft.chain).name} authorization and then enable the workflow on
            Reactive Lasna.
          </p>
          {(!settlementFactory() || !workflowActivationEnabled) && (
            <p className="app-copy">Testnet activation is disabled.</p>
          )}
          <div className="workflow-actions">
            <button
              type="button"
              className="app-button"
              disabled={wallet.busy}
              onClick={() => review(undefined)}
            >
              Back to editing
            </button>
            {wallet.owner ? (
              <button
                className="app-button app-button--primary"
                type="button"
                disabled={
                  wallet.busy ||
                  !workflowActivationEnabled ||
                  !settlementFactory() ||
                  (hasPayout && !consent)
                }
                onClick={async () => {
                  if (await wallet.activate(workflowId, draft.title.trim(), program)) {
                    try {
                      localStorage.removeItem(storageKey);
                    } catch {
                      /* The chain transaction is confirmed. */
                    }
                    navigate(`/workflows/${workflowId}`);
                  }
                }}
              >
                Activate workflow
              </button>
            ) : (
              <WalletControl setup />
            )}
          </div>
          <V2Feedback wallet={wallet} />
        </section>
      ) : (
        <>
          <div className="workflow-actions">
            {!id && (
              <button type="button" className="app-button" onClick={() => setRecipes(true)}>
                Browse recipes
              </button>
            )}
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={validating}
              onClick={() => void prepare()}
            >
              Review workflow
            </button>
            {id && (
              <Link className="app-button" to={`/workflows/${id}`}>
                Back to workflow
              </Link>
            )}
          </div>
          <div className="workflow-v2-columns workflow-v2-editor">
            <section
              className="app-panel app-panel-pad workflow-v2-stack"
              aria-label="Workflow graph"
            >
              <Input
                name="Workflow name"
                value={draft.title}
                change={(title) => update({ title })}
                text
              />
              <WorkflowCanvas
                draft={diagram.canvas}
                selected={canvasSelection}
                select={setCanvasSelection}
                positions={positions}
                onPositionsChange={(moved) => setPositions((current) => ({ ...current, ...moved }))}
                drop={{
                  mime: nodeMime,
                  active: Boolean(dragged),
                  hint: dragged ? 'Drop on a highlighted node' : undefined,
                  accepts: (target) => Boolean(dragged && accepts(dragged, target)),
                  receive: drop,
                }}
              />
              <button type="button" className="app-button" onClick={focusSettings}>
                Edit selected node
              </button>
              <div
                id="edit-trigger"
                tabIndex={-1}
                className="workflow-v2-path workflow-v2-stack"
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(nodeMime)) event.preventDefault();
                }}
                onDrop={(event) => {
                  const tool = tools.find(
                    (item) =>
                      item.group === 'trigger' &&
                      `${item.group}:${item.code}` === event.dataTransfer.getData(nodeMime),
                  );
                  if (tool?.group !== 'trigger') return;
                  event.preventDefault();
                  const problem = unavailable(tool, draft);
                  if (problem) setError(problem);
                  else update({ trigger: tool.code });
                }}
              >
                <strong>{triggers[draft.trigger]}</strong>
                {draft.trigger === T.schedule && (
                  <Input
                    name="Interval in seconds"
                    value={draft.interval}
                    change={(interval) => update({ interval })}
                  />
                )}
                {draft.trigger === T.transfer && (
                  <Input
                    name="Token contract address"
                    value={draft.source}
                    change={(source) => update({ source })}
                    text
                  />
                )}
                <details>
                  <summary>Live check settings</summary>
                  <div className="workflow-v2-stack">
                    <Input
                      name="Watched wallet address"
                      value={draft.subject}
                      change={(subject) => update({ subject })}
                      text
                    />
                  </div>
                </details>
              </div>
              <PathEditor
                anchor={workflowRootKey}
                path={draft.root}
                change={(root) => update({ root })}
                depth={0}
                {...{ draft, selected, place }}
              />
              <details>
                <summary>Spending limits and timing</summary>
                <div className="workflow-v2-settings">
                  <Input
                    name="Maximum USDC per run"
                    value={draft.usdcCap}
                    change={(usdcCap) => update({ usdcCap })}
                  />
                  <Input
                    name="Maximum WETH per run"
                    value={draft.wethCap}
                    change={(wethCap) => update({ wethCap })}
                  />
                  <Input
                    name="Maximum swap slippage (%)"
                    value={draft.slippage}
                    change={(slippage) => update({ slippage })}
                  />
                  <Input
                    name="Expires at (Unix seconds)"
                    value={draft.expires}
                    change={(expires) => update({ expires })}
                  />
                  <label className="workflow-v2-consent">
                    <input
                      type="checkbox"
                      checked={draft.once}
                      onChange={(event) => update({ once: event.target.checked })}
                    />
                    Close after a confirmed run
                  </label>
                </div>
              </details>
            </section>
            <aside className="app-panel app-panel-pad workflow-v2-stack" aria-label="Node library">
              <h2 className="app-panel-heading">Nodes</h2>
              <p className="app-copy">
                Drag a node onto a path, or select it and choose where to add it.
              </p>
              <div className="workflow-actions" aria-label="Node groups">
                {nodeGroups.map((group) => (
                  <button
                    className="app-button"
                    type="button"
                    key={group}
                    aria-pressed={group === nodeGroup}
                    onClick={() => setNodeGroup(group)}
                  >
                    {group}
                  </button>
                ))}
              </div>
              {[nodeGroup].map((group) => (
                <section key={group} className="workflow-v2-tools">
                  <h3>{group}</h3>
                  {tools
                    .filter((tool) =>
                      group === 'Triggers'
                        ? tool.group === 'trigger'
                        : group === 'Checks'
                          ? tool.group === 'check'
                          : tool.group === 'action' &&
                            (group === 'Notifications') === (tool.code === A.alert),
                    )
                    .map((tool) => {
                      const reason = unavailable(tool, draft);
                      return (
                        <button
                          type="button"
                          key={`${tool.group}:${tool.code}`}
                          className="app-button"
                          draggable={!reason}
                          disabled={Boolean(reason)}
                          aria-pressed={
                            tool.group === 'trigger'
                              ? tool.code === draft.trigger
                              : selected?.code === tool.code && selected?.group === tool.group
                          }
                          onDragStart={(event) => {
                            event.dataTransfer.setData(nodeMime, `${tool.group}:${tool.code}`);
                            setDragged(tool);
                          }}
                          onDragEnd={() => setDragged(undefined)}
                          onClick={() => {
                            if (tool.group === 'trigger') {
                              update({ trigger: tool.code });
                              pick(undefined);
                            } else {
                              pick(tool);
                              setStatus(`Choose a path for ${toolLabel(tool)}.`);
                            }
                          }}
                        >
                          {toolLabel(tool)}
                          {reason && <small>{reason}</small>}
                        </button>
                      );
                    })}
                </section>
              ))}
            </aside>
          </div>
        </>
      )}
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
      {program && !error && <span className="sr-only">{formatWorkflowCaps(program)}</span>}
    </section>
  );
}
