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
import {
  ArrowRight01Icon,
  Coins01Icon,
  GitBranchIcon,
  Notification03Icon,
  PlusSignIcon,
  Pulse01Icon,
  Search01Icon,
  Settings02Icon,
  Shield01Icon,
  TradeUpIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import type { FitViewOptions } from '@xyflow/react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { bytesToHex, type Hex } from 'viem';
import { useAccount } from 'wagmi';
import { z } from 'zod';

import { PageHeading } from '@/components/chrome/PageHeading';
import { WalletControl } from '@/components/chrome/WalletControl';
import { LoadingRegion, Skeleton } from '@/components/chrome/Skeleton';
import { Spinner } from '@/components/chrome/Spinner';
import { NetworkBadge } from '@/components/NetworkBadge';
import { WorkflowCanvas, type GraphSelection, type WorkflowNodePositions } from './Graph';
import { diagramV2, replacePath } from './diagramV2';
import { ListingStatusV2 } from './ListingStatusV2';
import { copyListingDraft, v2ListingId, v2ListingQuery } from './listingV2';
import { branchPathKey, type LibraryTarget } from './nodeLibraryModel';
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

const editorFitOptions = {
  padding: { top: '12px', bottom: '48px', x: '16px' },
  maxZoom: 1.05,
} satisfies FitViewOptions;

function toolLabel(tool: NodeTool) {
  if (tool.group === 'trigger') return triggers[tool.code];
  return tool.group === 'check' ? checks[tool.code].name : actions[tool.code].name;
}

function nodeIcon(tool: NodeTool) {
  if (tool.group === 'trigger') return Pulse01Icon;
  if (tool.group === 'check') return Shield01Icon;
  return tool.code === A.alert ? Notification03Icon : TradeUpIcon;
}

const recipeCategories = ['All categories', 'Trading', 'Payments', 'Wallet safety'] as const;

const recipeCategoryIcons: Record<string, ComponentProps<typeof HugeiconsIcon>['icon']> = {
  Trading: TradeUpIcon,
  Payments: Coins01Icon,
  'Wallet safety': Shield01Icon,
};

const recipeSummaries = {
  'scheduled-buy': 'Buy a fixed amount of WETH on a repeating schedule.',
  'buy-the-dip': 'Buy on schedule, but only after the price drops by a set percentage.',
  'limit-buy': 'Buy WETH once the pool price reaches your limit, then close.',
  'take-profit': 'Sell WETH once the price reaches your target, then close.',
  'trailing-stop': 'Sell after a fall from the high, with a deeper stop as a backstop.',
  'price-band': 'Sell above the band and buy below it around one reference price.',
  'recurring-transfer': 'Send a fixed USDC amount to one address on a repeating schedule.',
  'income-sweep': 'Sweep incoming USDC above a floor to another address.',
  'balance-refill': 'Top the vault back up with USDC when its balance falls below a floor.',
  'inactivity-payout': 'Send a fixed payout if the wallet stays inactive for a set time.',
  'price-alert': 'Record an alert when the price crosses a chosen target.',
  'price-range-alert': 'Record an alert when the price moves outside a range.',
  'large-transfer-alert': 'Record an alert when a token transfer exceeds an amount.',
} as const satisfies Record<WorkflowV2RecipeId, string>;

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
      {wallet.status && (
        <p className={wallet.busy ? 'rb-loading' : undefined}>
          {wallet.busy && <Spinner size={13} />}
          {wallet.status}
        </p>
      )}
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
  const [category, setCategory] = useState<(typeof recipeCategories)[number]>('All categories');
  const [selected, select] = useState<WorkflowV2RecipeId | undefined>(
    initialRecipe ?? workflowV2Recipes[0]?.id,
  );
  const [values, setValues] = useState<Record<string, string>>({ direction: 'rising' });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string>();
  const configurator = useRef<HTMLFormElement>(null);

  function choose(item: WorkflowV2RecipeId) {
    select(item);
    setValues({ direction: 'rising' });
    setConsent(false);
    setError(undefined);
    if (window.matchMedia('(max-width: 63.99rem)').matches) {
      requestAnimationFrame(() =>
        configurator.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    }
  }
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
    <div className="rb-template">
      <section className="app-panel rb-template-library" aria-label="Workflow recipes">
        <div className="rb-panel-head">
          <div>
            <p className="app-eyebrow">Recipes</p>
            <h2 className="rb-panel-title">Start from a proven program</h2>
            <p className="rb-panel-copy">
              Pick a template, set its inputs, then refine every node in the builder.
            </p>
          </div>
          <button type="button" className="app-button" onClick={close}>
            <HugeiconsIcon icon={Settings02Icon} size={15} aria-hidden="true" />
            Start from scratch
          </button>
        </div>
        <div className="rb-template-controls">
          <label className="rb-search">
            <span className="sr-only">Search recipes</span>
            <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
            <input
              className="app-input"
              type="search"
              value={search}
              placeholder="Search recipes"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="rb-segmented" role="group" aria-label="Recipe category">
            {recipeCategories.map((name) => (
              <button
                key={name}
                type="button"
                className="rb-segment"
                aria-pressed={category === name}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <ul className="rb-recipe-grid">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="rb-recipe-card"
                aria-pressed={item.id === selected}
                onClick={() => choose(item.id)}
              >
                <span className="rb-recipe-icon" aria-hidden="true">
                  <HugeiconsIcon
                    icon={recipeCategoryIcons[item.category] ?? Settings02Icon}
                    size={17}
                  />
                </span>
                <span className="rb-recipe-copy">
                  <span className="rb-recipe-kicker">{item.category}</span>
                  <span className="rb-recipe-title">{item.title}</span>
                  <span className="rb-recipe-summary">{recipeSummaries[item.id]}</span>
                  <span className="rb-recipe-meta">{v2Network(item.chain).name}</span>
                </span>
                <span className="rb-recipe-arrow" aria-hidden="true">
                  <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!visible.length && <p className="rb-template-empty">No recipes match this search.</p>}
      </section>
      <aside className="rb-template-aside">
        <form ref={configurator} className="app-panel rb-configurator" onSubmit={useRecipe}>
          <div className="rb-panel-head">
            <div>
              <p className="app-eyebrow">{recipe ? recipe.category : 'Recipe'}</p>
              <h2 className="rb-panel-title">{recipe ? recipe.title : 'Select a recipe'}</h2>
              <p className="rb-panel-copy">
                {recipe ? recipeSummaries[recipe.id] : 'Choose a card to configure its inputs.'}
              </p>
            </div>
            {recipe && <NetworkBadge chainId={recipe.chain} />}
          </div>
          {recipe ? (
            <>
              <div className="rb-configurator-body">
                <div className="rb-configurator-fields">
                  {recipeFields[recipe.id].map((field) =>
                    field === 'direction' ? (
                      <V2Field key={field} name="Alert when the price is">
                        <select
                          className="app-input"
                          value={values.direction}
                          onChange={(event) =>
                            setValues({ ...values, direction: event.target.value })
                          }
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
                </div>
                {recipe.id === 'inactivity-payout' && (
                  <label className="rb-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    I authorize one fixed payout after a 24-hour grace period.
                  </label>
                )}
                {error && (
                  <p className="rb-alert" role="alert">
                    {error}
                  </p>
                )}
              </div>
              <div className="rb-configurator-foot">
                <button className="app-button app-button--primary" type="submit">
                  Open in builder
                  <HugeiconsIcon icon={ArrowRight01Icon} size={15} aria-hidden="true" />
                </button>
                <span className="rb-configurator-note">
                  Nothing activates until you review and sign.
                </span>
              </div>
            </>
          ) : (
            <div className="rb-configurator-body">
              <p className="app-copy">Choose a recipe to see its inputs.</p>
            </div>
          )}
        </form>
      </aside>
    </div>
  );
}

function pathLabel(anchor: string) {
  const branches = anchor
    .split('-')
    .filter((part) => part === 'yes' || part === 'otherwise')
    .map((part) => (part === 'yes' ? 'Yes' : 'Otherwise'));
  return branches.length ? `${branches.join(' / ')} path` : 'Main path';
}

function pathMeta(path: DraftPath) {
  if ('check' in path) return 'Condition';
  if (!path.steps.length) return 'Skips the run';
  return `${path.steps.length} step${path.steps.length === 1 ? '' : 's'}`;
}

function InspectorHead({
  icon,
  tone,
  title,
  subtitle,
  back,
}: {
  icon: ComponentProps<typeof HugeiconsIcon>['icon'];
  tone: 'trigger' | 'logic' | 'funds' | 'neutral';
  title: string;
  subtitle: string;
  back?: () => void;
}) {
  return (
    <header className="rb-inspector-head">
      <div className="rb-inspector-title">
        <span className="rb-inspector-icon" data-tone={tone} aria-hidden="true">
          <HugeiconsIcon icon={icon} size={15} strokeWidth={1.7} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {back && (
        <button type="button" className="rb-inspector-back" onClick={back}>
          Workflow
        </button>
      )}
    </header>
  );
}

export function WorkflowProgramSummary({ draft }: { draft: V2Draft }) {
  function show(path: DraftPath): ReactNode {
    if ('steps' in path)
      return path.steps.length ? (
        <ol className="rb-spec-steps">
          {path.steps.map((step, index) => (
            <li key={index}>
              <HugeiconsIcon icon={TradeUpIcon} size={12} aria-hidden="true" />
              <span>{actions[step.kind].name}</span>
              {step.amount && (
                <em>
                  {step.amount}{' '}
                  {step.unit === U.percent ? '% of payment' : actions[step.kind].asset}
                </em>
              )}
              {step.recipient && <code>{step.recipient}</code>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rb-spec-skip">Skip the run.</p>
      );
    return (
      <div className="rb-spec-branch">
        <div className="rb-spec-condition">
          <HugeiconsIcon icon={Shield01Icon} size={13} aria-hidden="true" />
          <strong>{checks[path.check].name}</strong>
          {path.value && (
            <span>
              {path.value}
              {path.upper && ` to ${path.upper}`}
            </span>
          )}
        </div>
        <div className="rb-spec-branches">
          <div>
            <h4>Yes</h4>
            {show(path.yes)}
          </div>
          <div>
            <h4>Otherwise</h4>
            {show(path.no)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rb-spec">
      <section className="rb-spec-block">
        <header>
          <span className="rb-spec-index">1</span>
          <h3>Trigger</h3>
        </header>
        <p className="rb-spec-value">
          {triggers[draft.trigger]}
          {draft.trigger === T.schedule && draft.interval && (
            <span> every {draft.interval} seconds</span>
          )}
        </p>
      </section>
      <section className="rb-spec-block">
        <header>
          <span className="rb-spec-index">2</span>
          <h3>Logic</h3>
        </header>
        {show(draft.root)}
      </section>
      <section className="rb-spec-block">
        <header>
          <span className="rb-spec-index">3</span>
          <h3>Guardrails</h3>
        </header>
        <dl className="rb-spec-facts">
          <div>
            <dt>Settlement network</dt>
            <dd>{v2Network(draft.chain).name}</dd>
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
      </section>
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
  const query = useQuery({
    queryKey: ['workflow-v2', 'edit', address, raw],
    enabled: Boolean(id.success && address),
    queryFn: () => readWorkflowV2(address!, id.data!),
  });
  if (raw && !id.success) return <p role="alert">This workflow link is invalid.</p>;
  if (raw && !address)
    return (
      <section className="app-page">
        <PageHeading title="Edit workflow" />
        <WalletControl setup />
      </section>
    );
  if (raw && query.isPending)
    return (
      <section className="app-page">
        <PageHeading title="Edit workflow" description="Reading the program you saved." />
        <LoadingRegion label="Reading your workflow…" className="rb-page-skeleton">
          <Skeleton className="rb-skeleton--toolbar" />
          <div className="rb-builder-skeleton-grid">
            <Skeleton className="rb-skeleton--canvas" />
            <Skeleton className="rb-skeleton--panel" />
          </div>
        </LoadingRegion>
      </section>
    );
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (copy && !copyId.success) return <p role="alert">This listing link is invalid.</p>;
  const recipe = workflowV2Recipes.find((item) => item.id === params.get('recipe'))?.id;
  if (!raw && copyId.success)
    return <WorkflowCopyV2 key={copyId.data} listingId={copyId.data} recipe={recipe} />;

  return (
    <Editor
      key={`${raw ? address : 'new'}:${raw ?? 'new'}:${copy ?? recipe ?? ''}`}
      id={id.data}
      storageKey={`rulebook-v2-draft:${raw ?? copy ?? recipe ?? 'new'}`}
      original={query.data && toDraft(decodeWorkflowV2(query.data.program), query.data.title)}
      recipe={recipe}
    />
  );
}

function WorkflowCopyV2({ listingId, recipe }: { listingId: string; recipe?: WorkflowV2RecipeId }) {
  const storageKey = `rulebook-v2-draft:${listingId}`;
  const [original, setOriginal] = useState(() => loadDraft(storageKey)?.draft);
  const listing = useQuery(v2ListingQuery(original ? undefined : listingId));
  if (original) return <Editor storageKey={storageKey} original={original} recipe={recipe} />;
  // Once seeded, the private draft can be edited independently of the source listing.
  if (listing.isFetchedAfterMount && listing.isSuccess && !listing.failureReason)
    setOriginal(copyListingDraft(listing.data));
  return <ListingStatusV2 query={listing} copying />;
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
  const [canvasSelection, setCanvasSelection] = useState<GraphSelection | null>(null);
  const [canvasStep, setCanvasStep] = useState<number>();
  const [inspectorView, setInspectorView] = useState<'properties' | 'library'>('properties');
  const inspectorBody = useRef<HTMLDivElement>(null);
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
  useLayoutEffect(() => {
    inspectorBody.current?.scrollTo({ top: 0 });
  }, [canvasSelection, canvasStep, inspectorView]);
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
      return false;
    }
    if (tool.group === 'trigger') {
      update({ trigger: tool.code });
      return true;
    }
    if (tool.group === 'check') {
      if (depth >= workflowLimits.conditionDepth) {
        setError('A path can have up to three checks.');
        return false;
      }
      change({ check: tool.code, value: '', upper: '', yes: leaf, no: emptyPath() });
    } else {
      if (leaf.steps.length >= workflowLimits.stepsPerPath) {
        setError('A path can have up to three actions.');
        return false;
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
    return true;
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
      selectNode('trigger');
      return;
    }
    if (target.owner === 'trigger') return;
    const match = diagram.paths[target.owner];
    if (!match || !('steps' in match.path)) return;
    if (
      place(
        tool,
        match.path,
        (path) => update({ root: replacePath(draft.root, match.path, path) }),
        match.depth,
        target.afterStep,
      )
    )
      selectNode(target.owner);
  }

  function selectNode(selection: GraphSelection, step?: number) {
    setCanvasSelection(selection);
    setCanvasStep(step);
    setInspectorView('properties');
  }

  function showWorkflow() {
    setCanvasSelection(null);
    setCanvasStep(undefined);
    setInspectorView('properties');
    setStatus(undefined);
  }

  function placeSelected(index: number) {
    if (!selected || selected.group === 'trigger') return;
    const target = diagram.paths[index];
    if (!target || !('steps' in target.path)) return;
    const step = selected.group === 'action' ? target.path.steps.length : undefined;
    const placed = place(
      selected,
      target.path,
      (path) => update({ root: replacePath(draft.root, target.path, path) }),
      target.depth,
    );
    if (placed) selectNode(index, step);
  }

  function placeTrigger() {
    if (!selected || selected.group !== 'trigger') return;
    const problem = unavailable(selected, draft);
    if (problem) {
      setError(problem);
      return;
    }
    update({ trigger: selected.code });
    setStatus(`${toolLabel(selected)} set as the trigger.`);
    pick(undefined);
    selectNode('trigger');
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
      if (current === revision.current) {
        setError(
          cause instanceof Error ? cause.message.split('\n')[0] : 'Check the workflow settings.',
        );
        inspectorBody.current?.scrollTo({ top: 0 });
      }
    } finally {
      setValidating(false);
    }
  }

  const spendKinds = program?.nodes.flatMap((node) => node.actions.map((step) => step.kind)) ?? [];
  const hasPayout = spendKinds.includes(A.inactivityPayout);
  const selectedEntry =
    typeof canvasSelection === 'number' ? diagram.paths[canvasSelection] : undefined;
  const headingAside = recipes ? undefined : program ? (
    <div className="rb-action-row">
      <button type="button" className="app-button" onClick={() => review(undefined)}>
        Back to editing
      </button>
    </div>
  ) : (
    <div className="rb-action-row">
      {!id && (
        <button type="button" className="app-button" onClick={() => setRecipes(true)}>
          Browse recipes
        </button>
      )}
      {id && (
        <Link className="app-button" to={`/workflows/${id}`}>
          View workflow
        </Link>
      )}
      <button
        type="button"
        className="app-button app-button--primary"
        disabled={validating}
        onClick={() => void prepare()}
      >
        {validating ? 'Checking program…' : 'Review workflow'}
      </button>
    </div>
  );

  function renderProperties() {
    if (canvasSelection === null)
      return (
        <>
          <InspectorHead
            icon={Settings02Icon}
            tone="trigger"
            title="Workflow"
            subtitle="Name and limits"
          />
          <div className="rb-inspector-section">
            <V2Field name="Workflow name">
              <input
                className="app-input"
                value={draft.title}
                placeholder="Untitled workflow"
                maxLength={80}
                onChange={(event) => update({ title: event.target.value })}
              />
            </V2Field>
          </div>
          <div className="rb-inspector-section">
            <div className="rb-inspector-section-head">
              <h3>Guardrails</h3>
              <p>Caps and timing apply to every run.</p>
            </div>
            <div className="rb-inspector-fields">
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
            </div>
            <label className="rb-consent rb-consent--plain">
              <input
                type="checkbox"
                checked={draft.once}
                onChange={(event) => update({ once: event.target.checked })}
              />
              Close after a confirmed run
            </label>
          </div>
          <p className="rb-inspector-note">Select any node on the canvas to edit its settings.</p>
        </>
      );

    if (canvasSelection === 'trigger')
      return (
        <>
          <InspectorHead
            icon={Pulse01Icon}
            tone="trigger"
            title="Trigger"
            subtitle={triggers[draft.trigger]}
            back={showWorkflow}
          />
          <div className="rb-inspector-section">
            <V2Field name="Trigger type">
              <select
                className="app-input"
                value={draft.trigger}
                onChange={(event) => {
                  const next = Object.values(T).find(
                    (value) => String(value) === event.target.value,
                  );
                  if (next) update({ trigger: next });
                }}
              >
                {Object.values(T).map((code) => {
                  const reason = unavailable({ group: 'trigger', code }, draft);
                  return (
                    <option
                      key={code}
                      value={code}
                      disabled={Boolean(reason) && code !== draft.trigger}
                    >
                      {triggers[code]}
                      {reason && code !== draft.trigger ? ` - ${reason}` : ''}
                    </option>
                  );
                })}
              </select>
            </V2Field>
            <div className="rb-inspector-fields">
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
              <details className="rb-advanced">
                <summary>Live check settings</summary>
                <div className="rb-inspector-fields">
                  <Input
                    name="Watched wallet address"
                    value={draft.subject}
                    change={(subject) => update({ subject })}
                    text
                  />
                </div>
              </details>
            </div>
          </div>
        </>
      );

    if (!selectedEntry) return null;
    const path = selectedEntry.path;
    const changePath = (next: DraftPath) => update({ root: replacePath(draft.root, path, next) });

    if ('check' in path) {
      const metadata = checks[path.check];
      function openBranch(anchor: string) {
        const index = diagram.paths.findIndex((entry) => entry.anchor === anchor);
        if (index >= 0) selectNode(index);
      }
      return (
        <>
          <InspectorHead
            icon={GitBranchIcon}
            tone="logic"
            title={metadata.name}
            subtitle={`Condition in the ${pathLabel(selectedEntry!.anchor)}`}
            back={showWorkflow}
          />
          <div className="rb-inspector-section">
            <div className="rb-inspector-fields">
              {metadata.decimals !== undefined && (
                <Input
                  name={`${metadata.name} threshold`}
                  value={path.value}
                  change={(value) => changePath({ ...path, value })}
                />
              )}
              {metadata.upper && (
                <Input
                  name={metadata.upper}
                  value={path.upper}
                  change={(upper) => changePath({ ...path, upper })}
                />
              )}
            </div>
            <div className="rb-inspector-actions">
              <button
                type="button"
                className="workflow-text-button"
                onClick={() => {
                  changePath(path.yes);
                  setCanvasStep(undefined);
                }}
              >
                Keep Yes path only
              </button>
            </div>
          </div>
          <div className="rb-inspector-section">
            <div className="rb-inspector-section-head">
              <h3>Branches</h3>
              <p>Choose a branch to edit its nodes.</p>
            </div>
            <div className="rb-inspector-branches">
              <button
                type="button"
                className="rb-inspector-branch"
                onClick={() => openBranch(branchPathKey(selectedEntry!.anchor, 'yes'))}
              >
                <strong>Yes</strong>
                <small>{pathMeta(path.yes)}</small>
              </button>
              <button
                type="button"
                className="rb-inspector-branch"
                onClick={() => openBranch(branchPathKey(selectedEntry!.anchor, 'otherwise'))}
              >
                <strong>Otherwise</strong>
                <small>{pathMeta(path.no)}</small>
              </button>
            </div>
          </div>
        </>
      );
    }

    if (canvasStep !== undefined) {
      const stepIndex = canvasStep;
      const step = path.steps[stepIndex];
      if (step) {
        const metadata = actions[step.kind];
        const updateStep = (next: typeof step) =>
          changePath({
            steps: path.steps.map((current, index) => (index === stepIndex ? next : current)),
          });
        return (
          <>
            <InspectorHead
              icon={step.kind === A.alert ? Notification03Icon : TradeUpIcon}
              tone="funds"
              title={metadata.name}
              subtitle={`Step ${stepIndex + 1} of ${path.steps.length} in the ${pathLabel(selectedEntry.anchor)}`}
              back={showWorkflow}
            />
            <div className="rb-inspector-section">
              {(metadata.asset || metadata.recipient) && (
                <div className="rb-inspector-fields">
                  {metadata.asset && (
                    <>
                      {draft.trigger === T.payment &&
                        (step.kind === A.send || step.kind === A.buy) && (
                          <V2Field name="Amount type">
                            <select
                              className="app-input"
                              value={step.unit}
                              onChange={(event) =>
                                updateStep({
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
                          step.unit === U.percent
                            ? 'Percent of payment'
                            : `Amount in ${metadata.asset}`
                        }
                        value={step.amount}
                        change={(amount) => updateStep({ ...step, amount })}
                      />
                    </>
                  )}
                  {metadata.recipient && (
                    <Input
                      name="Recipient address"
                      value={step.recipient}
                      change={(recipient) => updateStep({ ...step, recipient })}
                      text
                    />
                  )}
                </div>
              )}
              {!metadata.asset && !metadata.recipient && (
                <p className="rb-inspector-copy">
                  This action records an alert when the trigger fires. It has no amount to set.
                </p>
              )}
              <div className="rb-inspector-actions">
                {stepIndex > 0 && (
                  <button
                    type="button"
                    className="workflow-text-button"
                    onClick={() => {
                      const steps = path.steps.slice();
                      const previous = steps[stepIndex - 1];
                      if (!previous) return;
                      steps[stepIndex - 1] = step;
                      steps[stepIndex] = previous;
                      changePath({ steps });
                      setCanvasStep(stepIndex - 1);
                    }}
                  >
                    Move earlier
                  </button>
                )}
                <button
                  type="button"
                  className="workflow-text-button"
                  data-tone="danger"
                  aria-label={`Remove step ${stepIndex + 1}`}
                  onClick={() => {
                    const steps = path.steps.filter((_, index) => index !== stepIndex);
                    changePath({ steps });
                    setCanvasStep(steps.length ? Math.min(stepIndex, steps.length - 1) : undefined);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </>
        );
      }
    }

    return (
      <>
        <InspectorHead
          icon={GitBranchIcon}
          tone="logic"
          title={pathLabel(selectedEntry.anchor)}
          subtitle={pathMeta(path)}
          back={showWorkflow}
        />
        <div className="rb-inspector-section">
          {path.steps.length ? (
            <ol className="rb-inspector-list">
              {path.steps.map((step, index) => (
                <li key={index}>
                  <button type="button" onClick={() => setCanvasStep(index)}>
                    <span>
                      <strong>{actions[step.kind].name}</strong>
                      <small>
                        {actions[step.kind].asset && step.amount
                          ? `${step.amount} ${
                              step.unit === U.percent ? '% of payment' : actions[step.kind].asset
                            }`
                          : `Step ${index + 1}`}
                      </small>
                    </span>
                    <span aria-hidden="true">Edit</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rb-inspector-copy">This path skips the run until you add a step.</p>
          )}
          <button type="button" className="app-button" onClick={() => setInspectorView('library')}>
            Add a node
          </button>
        </div>
      </>
    );
  }

  function renderLibrary() {
    const targets =
      selected && selected.group !== 'trigger'
        ? diagram.paths
            .map((entry, index) => ({ entry, index }))
            .filter(({ index }) => accepts(selected, { owner: index }))
        : [];
    return (
      <>
        <InspectorHead
          icon={PlusSignIcon}
          tone="neutral"
          title="Add a node"
          subtitle="Drag onto the canvas, or place it in a path."
        />
        <div className="rb-library-body">
          <div className="rb-segmented" role="group" aria-label="Node groups">
            {nodeGroups.map((group) => (
              <button
                className="rb-segment"
                type="button"
                key={group}
                aria-pressed={group === nodeGroup}
                onClick={() => setNodeGroup(group)}
              >
                {group}
              </button>
            ))}
          </div>
          <div className="rb-node-list">
            {tools
              .filter((tool) =>
                nodeGroup === 'Triggers'
                  ? tool.group === 'trigger'
                  : nodeGroup === 'Checks'
                    ? tool.group === 'check'
                    : tool.group === 'action' &&
                      (nodeGroup === 'Notifications') === (tool.code === A.alert),
              )
              .map((tool) => {
                const reason = unavailable(tool, draft);
                return (
                  <button
                    type="button"
                    key={`${tool.group}:${tool.code}`}
                    className="rb-node"
                    data-group={tool.group}
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
                    onClick={() => pick(tool)}
                  >
                    <span className="rb-node-icon" aria-hidden="true">
                      <HugeiconsIcon icon={nodeIcon(tool)} size={15} strokeWidth={1.7} />
                    </span>
                    <span className="rb-node-copy">
                      <strong>{toolLabel(tool)}</strong>
                      <small>
                        {reason ??
                          (tool.group === 'trigger'
                            ? 'Replaces the current trigger'
                            : tool.group === 'check'
                              ? 'Adds a condition'
                              : 'Adds an action')}
                      </small>
                    </span>
                    <span className="rb-node-add" aria-hidden="true">
                      <HugeiconsIcon icon={PlusSignIcon} size={13} />
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
        {selected &&
          (selected.group === 'trigger' ? (
            <div className="rb-placement">
              <div className="rb-placement-head">
                <strong>Place {toolLabel(selected)}</strong>
                <button type="button" className="rb-inspector-back" onClick={() => pick(undefined)}>
                  Cancel
                </button>
              </div>
              <button
                type="button"
                className="rb-placement-target"
                disabled={Boolean(unavailable(selected, draft))}
                onClick={placeTrigger}
              >
                <strong>Use as trigger</strong>
                <small>{unavailable(selected, draft) ?? 'Replaces the current trigger.'}</small>
              </button>
            </div>
          ) : targets.length ? (
            <div className="rb-placement">
              <div className="rb-placement-head">
                <strong>Place {toolLabel(selected)}</strong>
                <button type="button" className="rb-inspector-back" onClick={() => pick(undefined)}>
                  Cancel
                </button>
              </div>
              <div className="rb-placement-targets">
                {targets.map(({ entry, index }) => (
                  <button
                    type="button"
                    key={entry.anchor}
                    className="rb-placement-target"
                    onClick={() => placeSelected(index)}
                  >
                    <strong>{pathLabel(entry.anchor)}</strong>
                    <small>{pathMeta(entry.path)}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="rb-placement">
              <div className="rb-placement-head">
                <strong>Place {toolLabel(selected)}</strong>
                <button type="button" className="rb-inspector-back" onClick={() => pick(undefined)}>
                  Cancel
                </button>
              </div>
              <p className="rb-inspector-copy">
                No path can accept this node. Change the trigger or remove a step first.
              </p>
            </div>
          ))}
        <div className="rb-library-foot">
          <p role={selected ? 'status' : undefined}>
            {selected
              ? `Choose where to place ${toolLabel(selected)}.`
              : 'Drag onto the canvas, or select a node to place it.'}
          </p>
        </div>
      </>
    );
  }

  return (
    <section className={recipes || program ? 'app-page' : 'app-page rb-editor-page'}>
      <PageHeading
        eyebrow={recipes ? 'New workflow' : undefined}
        title={
          recipes
            ? 'Choose a starting point'
            : draft.title.trim() || (id ? 'Edit workflow' : 'Untitled workflow')
        }
        description={
          recipes ? 'Start from a proven recipe or build the program node by node.' : undefined
        }
        aside={headingAside}
      />
      {recipes ? (
        <RecipePicker
          initialRecipe={recipe}
          close={() => setRecipes(false)}
          open={(next) => {
            setDraft(next);
            setPositions({});
            setCanvasSelection(null);
            setCanvasStep(undefined);
            setInspectorView('properties');
            setRecipes(false);
          }}
        />
      ) : program ? (
        <div className="rb-review">
          <section className="app-panel rb-review-program">
            <div className="rb-panel-head">
              <div>
                <h2 className="rb-panel-title">Program review</h2>
                <p className="rb-panel-copy">
                  This is exactly what the agent evaluates and the vault executes.
                </p>
              </div>
              <span className="rb-chip rb-chip--plain">{v2Network(draft.chain).name}</span>
            </div>
            <div className="rb-panel-body">
              <WorkflowProgramSummary draft={draft} />
            </div>
          </section>

          <aside className="app-panel rb-activation" aria-label="Activation">
            <div className="rb-panel-head">
              <div>
                <h2 className="rb-panel-title">Activate</h2>
                <p className="rb-panel-copy">
                  Confirm the authorization and enable the workflow on Reactive Lasna.
                </p>
              </div>
            </div>
            <div className="rb-panel-body rb-activation-body">
              <dl className="rb-summary">
                <div>
                  <dt>Workflow</dt>
                  <dd>{draft.title.trim() || 'Untitled workflow'}</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>{v2Network(draft.chain).name}</dd>
                </div>
                <div>
                  <dt>Trigger</dt>
                  <dd>{triggers[draft.trigger]}</dd>
                </div>
                <div>
                  <dt>Per-run caps</dt>
                  <dd>
                    {draft.usdcCap || '0'} USDC · {draft.wethCap || '0'} WETH
                  </dd>
                </div>
              </dl>
              {hasPayout && (
                <label className="rb-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  Authorize the fixed payout after the 24-hour grace period.
                </label>
              )}
              {(!settlementFactory() || !workflowActivationEnabled) && (
                <p className="rb-alert">Testnet activation is disabled.</p>
              )}
              {wallet.owner ? (
                <button
                  className="app-button app-button--primary rb-full"
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
              <p className="rb-activation-note">
                Activation signs one Lasna transaction from your wallet. You can pause the workflow
                at any time.
              </p>
              <V2Feedback wallet={wallet} />
            </div>
          </aside>
        </div>
      ) : (
        <div className="rb-builder">
          <section className="rb-canvas-panel" aria-label="Workflow graph">
            <div className="rb-canvas-toolbar">
              <h2 className="rb-panel-title">Canvas</h2>
              <button type="button" className="app-button app-button--quiet" onClick={showWorkflow}>
                <HugeiconsIcon icon={Settings02Icon} size={15} aria-hidden="true" />
                Workflow settings
              </button>
            </div>
            <WorkflowCanvas
              draft={diagram.canvas}
              selected={canvasSelection ?? undefined}
              select={selectNode}
              positions={positions}
              onPositionsChange={(moved) => setPositions((current) => ({ ...current, ...moved }))}
              onPaneClick={showWorkflow}
              fitViewOptions={editorFitOptions}
              drop={{
                mime: nodeMime,
                active: Boolean(dragged),
                hint: dragged ? 'Drop on a highlighted node' : undefined,
                accepts: (target) => Boolean(dragged && accepts(dragged, target)),
                receive: drop,
              }}
            />
          </section>

          <aside className="app-panel rb-inspector" aria-label="Workflow inspector">
            <div className="rb-inspector-switch" role="group" aria-label="Inspector view">
              <button
                type="button"
                aria-pressed={inspectorView === 'properties'}
                onClick={() => setInspectorView('properties')}
              >
                Properties
              </button>
              <button
                type="button"
                aria-pressed={inspectorView === 'library'}
                onClick={() => setInspectorView('library')}
              >
                Library
              </button>
            </div>
            <div
              ref={inspectorBody}
              className="rb-inspector-body"
              role="region"
              aria-label="Inspector content"
              tabIndex={0}
            >
              {(status || error) && (
                <div className="rb-inspector-feedback">
                  {status && <p role="status">{status}</p>}
                  {error && (
                    <p className="rb-inspector-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              )}
              {inspectorView === 'properties' ? renderProperties() : renderLibrary()}
            </div>
          </aside>
        </div>
      )}
      {program && !error && <span className="sr-only">{formatWorkflowCaps(program)}</span>}
    </section>
  );
}
