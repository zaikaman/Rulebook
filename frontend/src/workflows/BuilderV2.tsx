import {
  addressIssue,
  amountIssue,
  capIssue,
  checkThresholdRules,
  checkUpperRules,
  createWorkflowV2Recipe,
  draftHasAction,
  draftHasCheck,
  draftHasSwap,
  draftSpending,
  decodeWorkflowV2,
  encodeWorkflowV2,
  fieldIssue,
  isFundsChain,
  networkModeForChain,
  readWeeklyLimit,
  slippageIssue,
  stepAmountRules,
  toCopyDraft,
  UNICHAIN_MAINNET_CHAIN_ID,
  weeklyBudgetFromDraft,
  workflowFieldSpecs,
  workflowGuardrailFields,
  workflowIdSchema,
  workflowLimits,
  workflowV2Limits,
  workflowV2Action as A,
  workflowV2Check as C,
  workflowV2Recipes,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type FundsChainId,
  type TriggerCode,
  type WeeklyBudgetAmounts,
  type WorkflowFieldName,
  type WorkflowFieldSpec,
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
  SparklesIcon,
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
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { bytesToHex, formatUnits, parseUnits, zeroAddress, type Hex } from 'viem';
import { useAccount } from 'wagmi';
import { z } from 'zod';

import { PageHeading } from '@/components/chrome/PageHeading';
import { MainnetUnavailableCallout } from '@/components/MainnetUnavailableCallout';
import { Button, Callout, Field, Select } from '@/ui';
import { formatContractError } from '@/lib/errors';
import { WalletControl } from '@/components/chrome/WalletControl';
import { LoadingRegion, Skeleton } from '@/components/chrome/Skeleton';
import { Spinner } from '@/components/chrome/Spinner';
import { NetworkBadge } from '@/components/NetworkBadge';
import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { setupHref } from '@/lib/routes';
import { RequireAccountSetup, useLinkedAccount } from './useLinkedAccount';
import { WorkflowCanvas, type GraphSelection, type WorkflowNodePositions } from './Graph';
import { WorkflowCreditNotice } from './WorkflowCredit';
import { useWorkflowFunding, WorkflowFundingNotice } from './WorkflowFunding';
import {
  hasRulewrightBaseline,
  RulewrightDialog,
  type RulewrightSession,
} from './RulewrightDialog';
import { diagramV2, replacePath } from './diagramV2';
import { ListingStatusV2 } from './ListingStatusV2';
import { v2ListingId, v2ListingQuery } from './listingV2';
import { branchPathKey, type LibraryTarget } from './nodeLibraryModel';
import {
  configuredFundsChains,
  formatWorkflowCaps,
  paymentWorkflowConflictMessage,
  workflowActivationEnabled,
  readActiveWorkflowCount,
  readPaymentWorkflow,
  readVault,
  readWorkflowV2,
  readWorkflowWeeklyBudget,
  settlementFactory,
  useWorkflowV2Wallet,
  validateV2Program,
  v2Explorer,
  v2Network,
  type SettlementChain,
} from './chainV2';
import {
  actions,
  checks,
  emptyDraft,
  emptyPath,
  recipeFields,
  toDraft,
  toProgram,
  triggers,
  unavailable,
  v2DraftSchema,
  type CheckCode,
  type DraftPath,
  type NodeTool,
  type V2Draft,
} from './modelV2';
import { PoolPriceAssist } from './PoolPriceAssist';

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
  'large-transfer-alert':
    'Record an alert when the watched wallet sends or receives a token amount above the threshold.',
} as const satisfies Record<WorkflowV2RecipeId, string>;

export function V2Field({
  name,
  hint,
  error,
  children,
}: {
  name: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Field label={name} hint={hint} error={error}>
      {children}
    </Field>
  );
}

function weeklyError(value: string, asset: 'USDC' | 'WETH') {
  try {
    readWeeklyLimit(value, asset);
    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Enter a valid limit.';
  }
}

function weeklyLabel(amount: bigint, decimals: number, asset: string) {
  return amount === 0n ? `${asset} unlimited` : `${formatUnits(amount, decimals)} ${asset}`;
}

function Input({
  name,
  value,
  change,
  hint,
  error,
  assist,
  placeholder,
  required = true,
  text = false,
  onBlur,
}: {
  name: string;
  value: string;
  change: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  assist?: ReactNode;
  placeholder?: string;
  required?: boolean;
  text?: boolean;
  onBlur?: () => void;
}) {
  return (
    <Field label={name} hint={hint} error={error} assist={assist}>
      {(ids) => (
        <input
          className="app-input"
          value={value}
          inputMode={text ? 'text' : 'decimal'}
          placeholder={placeholder}
          aria-invalid={Boolean(error) || undefined}
          aria-required={required || undefined}
          aria-describedby={[ids.hint, ids.error].filter(Boolean).join(' ') || undefined}
          onChange={(event) => change(event.target.value)}
          onBlur={onBlur}
        />
      )}
    </Field>
  );
}

function isPriceRecipeField(spec: WorkflowFieldSpec): boolean {
  return spec.kind === 'number' && spec.unit === 'USDC per WETH';
}

function isPriceCheckThreshold(check: CheckCode): boolean {
  return (
    check === C.priceAtLeast ||
    check === C.priceAtMost ||
    check === C.priceBelow ||
    check === C.priceOutside ||
    check === C.priceRisesThrough ||
    check === C.priceFallsThrough
  );
}

function isPriceCheckUpper(check: CheckCode): boolean {
  return check === C.priceOutside || check === C.aboveReference || check === C.belowReference;
}

function priceOutsideUpperIssue(lowerValue: string, upperValue: string) {
  const issue = amountIssue(upperValue, checkUpperRules(C.priceOutside));
  if (issue) return issue;
  if (!lowerValue.trim() || amountIssue(lowerValue, checkThresholdRules(C.priceOutside, T.price))) {
    return undefined;
  }
  return parseUnits(upperValue.trim(), 18) <= parseUnits(lowerValue.trim(), 18)
    ? 'Set an upper price above the lower price.'
    : undefined;
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
  const { address } = useAccount();
  const { mode, defaultFundsChainId } = useNetworkMode();
  const chains = configuredFundsChains(mode);
  const fallbackChain = chains[0] ?? defaultFundsChainId;
  const [recipeChain, setRecipeChain] = useState<SettlementChain>(fallbackChain);
  useEffect(() => {
    if (!chains.includes(recipeChain)) setRecipeChain(fallbackChain);
  }, [chains, fallbackChain, recipeChain]);
  const recipeVaultQuery = useQuery({
    queryKey: ['workflow-v2', 'vault', mode, address?.toLowerCase(), recipeChain],
    enabled: Boolean(address),
    queryFn: () => readVault(address!, recipeChain),
    staleTime: 30_000,
  });
  const recipeVault =
    recipeVaultQuery.data && recipeVaultQuery.data !== zeroAddress
      ? recipeVaultQuery.data
      : undefined;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<(typeof recipeCategories)[number]>('All categories');
  const [selected, select] = useState<WorkflowV2RecipeId | undefined>(
    initialRecipe ?? workflowV2Recipes[0]?.id,
  );
  const [values, setValues] = useState<Record<string, string>>({ direction: 'rising' });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string>();
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const configurator = useRef<HTMLFormElement>(null);

  function choose(item: WorkflowV2RecipeId) {
    select(item);
    setValues({ direction: 'rising' });
    setConsent(false);
    setError(undefined);
    setTouched(new Set());
    setAttempted(false);
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

  function recipeFieldIssue(field: string) {
    const spec = workflowFieldSpecs[field as WorkflowFieldName];
    if (!spec) return undefined;
    if ((field === 'recipient' || field === 'heir') && recipeVault) {
      return fieldIssue(spec, values[field], {
        disallowed: recipeVault,
        disallowedMessage: 'Choose a wallet other than your vault.',
      });
    }
    return fieldIssue(spec, values[field]);
  }

  function shownIssue(field: string) {
    if (!attempted && !touched.has(field)) return undefined;
    return recipeFieldIssue(field);
  }

  function useRecipe(event: FormEvent) {
    event.preventDefault();
    if (!recipe) return;
    setAttempted(true);
    const invalid = recipeFields[recipe.id].find((field) => Boolean(recipeFieldIssue(field)));
    if (invalid) {
      configurator.current
        ?.querySelector<HTMLElement>(
          `[data-recipe-field="${invalid}"] input, [data-recipe-field="${invalid}"] select`,
        )
        ?.focus();
      return;
    }
    try {
      const program = createWorkflowV2Recipe(recipe.id, values, {
        inactivityPayout: consent,
        chain: recipeChain,
        originChain: recipeChain,
        vault: recipeVault,
      });
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
                  <span className="rb-recipe-meta">
                    {chains.length > 0
                      ? chains.map((id) => v2Network(id).name).join(' · ')
                      : v2Network(defaultFundsChainId).name}
                  </span>
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
            {recipe && <NetworkBadge chainId={recipeChain} />}
          </div>
          {recipe ? (
            <>
              <div className="rb-configurator-body">
                <div className="rb-configurator-fields">
                  {chains.length > 1 && (
                    <V2Field name="Settlement network">
                      <Select
                        value={String(recipeChain)}
                        groups={[
                          {
                            label: 'Settlement network',
                            options: chains.map((id) => ({
                              value: String(id),
                              label: v2Network(id).name,
                            })),
                          },
                        ]}
                        onChange={(nextValue) => {
                          const next = Number(nextValue);
                          if (isFundsChain(next)) setRecipeChain(next);
                        }}
                      />
                    </V2Field>
                  )}
                  {recipeFields[recipe.id].map((field) => {
                    const spec = workflowFieldSpecs[field];
                    if (!spec) return null;
                    const baseHint = 'hint' in spec ? spec.hint : undefined;
                    const hint =
                      field === 'slippagePercent' && recipeChain === UNICHAIN_MAINNET_CHAIN_ID
                        ? 'At least 0.01% and at most 10%. On Unichain Mainnet, 1% or higher is recommended due to 24-hour Chainlink heartbeats and linear Uniswap V3 quoting; keep single swaps small relative to pool depth.'
                        : baseHint;
                    const issue = shownIssue(field);
                    if (spec.kind === 'direction') {
                      return (
                        <div key={field} data-recipe-field={field}>
                          <V2Field name={spec.label} hint={hint} error={issue}>
                            <select
                              className="app-input"
                              value={values[field] ?? 'rising'}
                              aria-invalid={Boolean(issue) || undefined}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field]: event.target.value,
                                }))
                              }
                              onBlur={() => setTouched((current) => new Set(current).add(field))}
                            >
                              <option value="rising">At or above target</option>
                              <option value="falling">At or below target</option>
                            </select>
                          </V2Field>
                        </div>
                      );
                    }
                    return (
                      <div key={field} data-recipe-field={field}>
                        <Input
                          name={spec.label}
                          value={values[field] ?? ''}
                          text={spec.kind === 'address'}
                          placeholder={spec.placeholder}
                          hint={hint}
                          error={issue}
                          assist={
                            isPriceRecipeField(spec) ? (
                              <PoolPriceAssist
                                chain={recipeChain}
                                value={values[field] ?? ''}
                                onSelect={(next) => {
                                  setValues((current) => ({ ...current, [field]: next }));
                                  setTouched((current) => new Set(current).add(field));
                                }}
                              />
                            ) : undefined
                          }
                          change={(value) =>
                            setValues((current) => ({ ...current, [field]: value }))
                          }
                          onBlur={() => setTouched((current) => new Set(current).add(field))}
                        />
                      </div>
                    );
                  })}
                </div>
                {recipe.id === 'inactivity-payout' && (
                  <label className="rb-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    I authorize one fixed payout after 24 hours of grace and 10 minutes for final
                    confirmation.
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

export function WorkflowProgramSummary({
  draft,
  weekly,
}: {
  draft: V2Draft;
  weekly?: WeeklyBudgetAmounts;
}) {
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
          {draft.originChain !== draft.chain && (
            <div>
              <dt>Trigger network</dt>
              <dd>{v2Network(draft.originChain).name}</dd>
            </div>
          )}
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
          {weekly && (
            <div>
              <dt>Weekly budget</dt>
              <dd>
                {weeklyLabel(weekly.usdc, 6, 'USDC')} · {weeklyLabel(weekly.weth, 18, 'WETH')}
              </dd>
            </div>
          )}
          {Number(draft.slippage) > 0 && (
            <div>
              <dt>Maximum swap slippage</dt>
              <dd>{draft.slippage}%</dd>
            </div>
          )}
          {draft.trigger === T.transfer && draft.source && (
            <div>
              <dt>Token contract</dt>
              <dd className="workflow-v2-address">{draft.source}</dd>
            </div>
          )}
          {draft.subject &&
            (draft.trigger === T.transfer ||
              (draft.trigger === T.payment && draftHasCheck(draft, C.paymentFrom))) && (
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

export function WorkflowEditRouteV2() {
  return (
    <RequireAccountSetup title="Edit workflow">{() => <WorkflowBuilderV2 />}</RequireAccountSetup>
  );
}

export function WorkflowBuilderV2() {
  const { mode, isMainnet, automationName, isDeploymentConfigured } = useNetworkMode();
  const { address } = useAccount();
  const [params, setSearchParams] = useSearchParams();
  const startReview = params.get('review') === '1';
  const consumeReview = () => {
    if (!params.has('review')) return;
    const next = new URLSearchParams(params);
    next.delete('review');
    setSearchParams(next, { replace: true });
  };
  const { id: raw } = useParams();
  const id = workflowIdSchema.safeParse(raw);
  const rawChain = params.get('chain');
  const parsedChain = rawChain ? Number(rawChain) : NaN;
  const preferredChain =
    isFundsChain(parsedChain) && networkModeForChain(parsedChain) === mode
      ? (parsedChain as SettlementChain)
      : undefined;
  const copy = params.get('copy');
  const copyId = v2ListingId.safeParse(copy);
  const query = useQuery({
    queryKey: ['workflow-v2', 'edit', mode, address, raw, preferredChain],
    enabled: Boolean(id.success && address && isDeploymentConfigured),
    queryFn: () => readWorkflowV2(address!, id.data!, mode, preferredChain),
  });
  const budgetQuery = useQuery({
    queryKey: ['workflow-v2', 'weekly-budget', mode, address, raw, query.data?.chain],
    enabled: Boolean(id.success && address && isDeploymentConfigured && query.data),
    queryFn: () => readWorkflowWeeklyBudget(query.data!.chain, query.data!.vault, id.data!),
  });
  if (raw && !id.success) return <p role="alert">This workflow link is invalid.</p>;
  if (raw && !isDeploymentConfigured) {
    return (
      <section className="app-page">
        <PageHeading title="Edit workflow" />
        {isMainnet ? (
          <MainnetUnavailableCallout context="Editing workflows" />
        ) : (
          <Callout title={`Contracts are not configured for ${automationName}`}>
            <p>
              Editing workflows requires deployed {automationName} contracts in this environment.
            </p>
          </Callout>
        )}
      </section>
    );
  }
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
  if (raw && budgetQuery.isPending)
    return (
      <section className="app-page">
        <PageHeading title="Edit workflow" description="Reading the weekly spending budget." />
        <LoadingRegion label="Reading the weekly budget…" className="rb-page-skeleton">
          <Skeleton className="rb-skeleton--panel" />
        </LoadingRegion>
      </section>
    );
  if (raw && budgetQuery.error)
    return (
      <p className="workflow-error" role="alert">
        The weekly budget could not be read. Reopen this workflow before editing it.
      </p>
    );
  if (copy && !copyId.success) return <p role="alert">This listing link is invalid.</p>;
  const recipe = workflowV2Recipes.find((item) => item.id === params.get('recipe'))?.id;
  if (!raw && copyId.success)
    return (
      <WorkflowCopyV2
        key={`${mode}:${copyId.data}`}
        listingId={copyId.data}
        recipe={recipe}
        startReview={startReview}
        onConsumeReview={consumeReview}
      />
    );

  const editChain = raw ? (query.data?.chain ?? preferredChain ?? '') : '';

  return (
    <Editor
      key={`${mode}:${raw ? `${editChain}:${address}` : 'new'}:${raw ?? 'new'}:${copy ?? recipe ?? ''}`}
      id={id.data}
      storageKey={`rulebook-v2-draft:${mode}:${raw ? `${editChain}:${raw}` : (copy ?? recipe ?? 'new')}`}
      original={
        query.data && budgetQuery.data
          ? {
              ...toDraft(decodeWorkflowV2(query.data.program), query.data.title),
              usdcWeeklyBudget:
                budgetQuery.data.usdcLimit > 0n ? formatUnits(budgetQuery.data.usdcLimit, 6) : '',
              wethWeeklyBudget:
                budgetQuery.data.wethLimit > 0n ? formatUnits(budgetQuery.data.wethLimit, 18) : '',
            }
          : undefined
      }
      recipe={recipe}
      startBlank={params.get('template') === 'blank'}
      startReview={startReview}
      onConsumeReview={consumeReview}
      active={query.data?.active}
    />
  );
}

function WorkflowCopyV2({
  listingId,
  recipe,
  startReview = false,
  onConsumeReview,
}: {
  listingId: string;
  recipe?: WorkflowV2RecipeId;
  startReview?: boolean;
  onConsumeReview?: () => void;
}) {
  const { mode } = useNetworkMode();
  const storageKey = `rulebook-v2-draft:${mode}:${listingId}`;
  const [original, setOriginal] = useState(() => loadDraft(storageKey)?.draft);
  const listing = useQuery(v2ListingQuery(original ? undefined : listingId, mode));
  useEffect(() => {
    if (!original && listing.isFetchedAfterMount && listing.isSuccess && !listing.failureReason) {
      setOriginal(toCopyDraft(decodeWorkflowV2(listing.data.program), listing.data.title));
    }
  }, [
    listing.data,
    listing.failureReason,
    listing.isFetchedAfterMount,
    listing.isSuccess,
    original,
  ]);
  if (original)
    return (
      <Editor
        storageKey={storageKey}
        original={original}
        recipe={recipe}
        startReview={startReview}
        onConsumeReview={onConsumeReview}
      />
    );
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

function supportsCrossChain(trigger: TriggerCode, dipBy: boolean) {
  return trigger === T.price || trigger === T.transfer || (trigger === T.schedule && dipBy);
}

function Editor({
  id,
  original,
  recipe,
  startBlank = false,
  startReview = false,
  onConsumeReview,
  storageKey,
  active = false,
}: {
  id?: Hex;
  original?: V2Draft;
  recipe?: WorkflowV2RecipeId;
  startBlank?: boolean;
  startReview?: boolean;
  onConsumeReview?: () => void;
  storageKey: string;
  active?: boolean;
}) {
  const wallet = useWorkflowV2Wallet();
  const linkedAccount = useLinkedAccount();
  const { mode, automationName, defaultFundsChainId, isDeploymentConfigured, isMainnet } =
    useNetworkMode();
  const chains = configuredFundsChains(mode);
  const { address } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const [saved] = useState(() => loadDraft(storageKey));
  const [draft, setDraft] = useState<V2Draft>(
    () => saved?.draft ?? original ?? emptyDraft(defaultFundsChainId),
  );
  const vaultQuery = useQuery({
    queryKey: ['workflow-v2', 'vault', mode, address?.toLowerCase(), draft.chain],
    enabled: Boolean(address && isFundsChain(draft.chain)),
    queryFn: () => readVault(address!, draft.chain as SettlementChain),
    staleTime: 30_000,
  });
  const vault = vaultQuery.data && vaultQuery.data !== zeroAddress ? vaultQuery.data : undefined;
  useEffect(() => {
    if (!id && networkModeForChain(draft.chain) !== mode) {
      setDraft((current) => ({
        ...current,
        chain: defaultFundsChainId,
        originChain: defaultFundsChainId,
      }));
    }
  }, [defaultFundsChainId, draft.chain, id, mode]);
  const diagram = useMemo(() => diagramV2(draft), [draft]);
  const spending = useMemo(() => draftSpending(draft), [draft]);
  const hasSwap = useMemo(() => draftHasSwap(draft), [draft]);
  const hasDipBy = useMemo(() => draftHasCheck(draft, C.dipBy), [draft]);
  const hasInactivityPayout = useMemo(() => draftHasAction(draft, A.inactivityPayout), [draft]);
  const hasPaymentFrom = useMemo(() => draftHasCheck(draft, C.paymentFrom), [draft]);
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
  const [recipes, setRecipes] = useState(!original && !saved && !startBlank);
  const [rulewrightOpen, setRulewrightOpen] = useState(false);
  const rulewrightSession = useRef<RulewrightSession>(undefined);
  const [selected, pick] = useState<NodeTool>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [program, review] = useState<WorkflowV2Program>();
  const [budget, setBudget] = useState<WeeklyBudgetAmounts>();
  const funding = useWorkflowFunding(wallet.owner, program, budget);
  const slots = useQuery({
    queryKey: ['workflow-v2', 'active-count', mode, wallet.owner],
    enabled: Boolean(
      wallet.owner && program && workflowActivationEnabled && isDeploymentConfigured,
    ),
    queryFn: () => readActiveWorkflowCount(wallet.owner!, mode),
  });
  const capReached =
    !active && slots.data !== undefined && slots.data >= workflowV2Limits.activePerAgent;
  const paymentSlot = useQuery({
    queryKey: ['workflow-v2', 'payment-workflow', wallet.owner, draft.chain],
    enabled: Boolean(
      wallet.owner &&
      (program ? program.trigger === T.payment : draft.trigger === T.payment) &&
      workflowActivationEnabled &&
      settlementFactory(draft.chain as SettlementChain),
    ),
    queryFn: () => readPaymentWorkflow(wallet.owner!, draft.chain as SettlementChain),
  });
  const paymentConflict =
    (program ? program.trigger === T.payment : draft.trigger === T.payment) &&
    paymentSlot.data &&
    paymentSlot.data.id.toLowerCase() !== workflowId.toLowerCase()
      ? paymentSlot.data
      : null;
  const [consent, setConsent] = useState(false);
  const [validating, setValidating] = useState(false);
  const revision = useRef(0);
  const autoReviewed = useRef(false);
  useEffect(() => {
    if (
      !startReview ||
      autoReviewed.current ||
      recipes ||
      program ||
      (address &&
        isFundsChain(draft.chain) &&
        (vaultQuery.isPending || (vaultQuery.isFetching && !vault)))
    ) {
      return;
    }
    autoReviewed.current = true;
    onConsumeReview?.();
    void prepare();
  });
  useEffect(() => {
    if (
      rulewrightSession.current?.owner !== address ||
      rulewrightSession.current?.network !== mode
    ) {
      rulewrightSession.current = undefined;
    }
  }, [address, mode]);
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
    setDraft((current) => {
      const next = { ...current, ...fields };
      if (
        !supportsCrossChain(next.trigger, draftHasCheck(next, C.dipBy)) &&
        next.originChain !== next.chain
      ) {
        return { ...next, originChain: next.chain };
      }
      return next;
    });
    setError(undefined);
    review(undefined);
    setBudget(undefined);
    setConsent(false);
  }

  function placementIssue(
    tool: NodeTool,
    branch: (typeof diagram.paths)[number],
    afterStep?: number,
  ): string | undefined {
    const problem = unavailable(tool, draft);
    if (problem) return problem;
    if (!('steps' in branch.path)) return 'Choose a step path on the canvas.';
    const leaf = branch.path;
    if (tool.group === 'check') {
      if (branch.depth >= workflowLimits.conditionDepth) {
        return 'A path can have up to three checks.';
      }
      if (afterStep !== undefined && afterStep !== 0) {
        return 'Place conditions at the start of a path.';
      }
      if (
        tool.code === C.inactivity &&
        leaf.steps.some((step) => step.kind !== A.inactivityPayout && step.kind !== A.alert)
      ) {
        return 'Only an inactivity payout or alert can run inside the Yes branch of an inactivity check.';
      }
      return undefined;
    }
    if (leaf.steps.length >= workflowLimits.stepsPerPath) {
      return 'A path can have up to three actions.';
    }
    if (leaf.steps.some((step) => step.kind === A.inactivityPayout)) {
      return 'Send inactivity payout cannot be combined with other actions on the same path.';
    }
    if (tool.code === A.refill && !branch.activeChecks.has(C.usdcBelow)) {
      return 'Refill Vault USDC must be inside the Yes branch of a Vault USDC is below check.';
    }
    if (tool.code === A.inactivityPayout) {
      if (!branch.activeChecks.has(C.inactivity)) {
        return 'Send inactivity payout must be inside the Yes branch of a Wallet was inactive for check.';
      }
      if (leaf.steps.length > 0) {
        return 'Send inactivity payout cannot be combined with other actions on the same path.';
      }
      return undefined;
    }
    if (tool.code !== A.alert && branch.activeChecks.has(C.inactivity)) {
      return 'Only a single inactivity payout can run inside the Yes branch of an inactivity check.';
    }
    if (
      (tool.code === A.buy || tool.code === A.sell) &&
      leaf.steps.some((step) => step.kind === A.buy || step.kind === A.sell)
    ) {
      return 'A single path can include at most one buy or sell action.';
    }
    return undefined;
  }

  function place(
    tool: NodeTool,
    branch: (typeof diagram.paths)[number],
    change: (path: DraftPath) => void,
    afterStep?: number,
  ) {
    const problem = placementIssue(tool, branch, afterStep);
    if (problem) {
      setError(problem);
      return false;
    }
    if (tool.group === 'trigger') {
      update({ trigger: tool.code });
      return true;
    }
    if (!('steps' in branch.path)) return false;
    const leaf = branch.path;
    if (tool.group === 'check') {
      change({ check: tool.code, value: '', upper: '', yes: leaf, no: emptyPath() });
    } else {
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
    return !placementIssue(tool, branch, target.afterStep);
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
        match,
        (path) => update({ root: replacePath(draft.root, match.path, path) }),
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
    const placed = place(selected, target, (path) =>
      update({ root: replacePath(draft.root, target.path, path) }),
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
      const next = toProgram(draft, { vault });
      const nextBudget = weeklyBudgetFromDraft(draft);
      await validateV2Program(encodeWorkflowV2(next), next);
      if (current !== revision.current) return;
      review(next);
      setBudget(nextBudget);
      setStatus(undefined);
      setError(undefined);
    } catch (cause) {
      if (current === revision.current) {
        setError(formatContractError(cause, 'Check the workflow settings.'));
        inspectorBody.current?.scrollTo({ top: 0 });
      }
    } finally {
      setValidating(false);
    }
  }

  const paymentConflictCallout = paymentConflict ? (
    <Callout
      title="One payment workflow per Vault"
      action={
        <Link
          className="app-button"
          to={withNetworkQuery(`/workflows/${paymentConflict.id}?chain=${draft.chain}`, mode)}
        >
          Open {paymentConflict.title ?? 'existing workflow'}
        </Link>
      }
    >
      <p>{paymentWorkflowConflictMessage(paymentConflict.title)}</p>
    </Callout>
  ) : null;

  const spendKinds = program?.nodes.flatMap((node) => node.actions.map((step) => step.kind)) ?? [];
  const hasPayout = spendKinds.includes(A.inactivityPayout);
  const selectedEntry =
    typeof canvasSelection === 'number' ? diagram.paths[canvasSelection] : undefined;
  const headingAside = recipes ? (
    <button type="button" className="app-button" onClick={() => setRulewrightOpen(true)}>
      Draft with Rulewright
    </button>
  ) : program ? (
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
        <Link
          className="app-button"
          to={withNetworkQuery(`/workflows/${id}?chain=${draft.chain}`, mode)}
        >
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
            <V2Field
              name="Workflow name"
              hint="Up to 80 bytes. Shown in your workspace and on-chain records."
              error={
                new TextEncoder().encode(draft.title.trim()).length > 80
                  ? 'Use a workflow name of up to 80 bytes.'
                  : undefined
              }
            >
              <input
                className="app-input"
                value={draft.title}
                placeholder="Untitled workflow"
                maxLength={80}
                onChange={(event) => update({ title: event.target.value })}
              />
            </V2Field>
            {chains.length > 1 && (
              <V2Field
                name="Settlement network"
                hint={
                  id
                    ? 'The Vault network is fixed once a workflow is created.'
                    : `Choose which ${mode} Vault holds funds and settles this workflow.`
                }
              >
                {id ? (
                  <p className="rb-note">{v2Network(draft.chain).name}</p>
                ) : (
                  <Select
                    value={String(draft.chain)}
                    groups={[
                      {
                        label: 'Funds & settlement networks',
                        options: chains.map((chainId) => ({
                          value: String(chainId),
                          label: v2Network(chainId).name,
                        })),
                      },
                    ]}
                    onChange={(nextValue) => {
                      const nextChain = Number(nextValue);
                      if (!isFundsChain(nextChain)) return;
                      const crossCapable = supportsCrossChain(draft.trigger, hasDipBy);
                      update({
                        chain: nextChain as FundsChainId,
                        ...(draft.originChain === draft.chain || !crossCapable
                          ? { originChain: nextChain as FundsChainId }
                          : {}),
                      });
                    }}
                  />
                )}
              </V2Field>
            )}
          </div>
          <div className="rb-inspector-section">
            <div className="rb-inspector-section-head">
              <h3>Guardrails</h3>
              <p>Caps and timing apply to every run.</p>
            </div>
            <div className="rb-inspector-fields">
              <Input
                name={workflowGuardrailFields.usdcCap.label}
                value={draft.usdcCap}
                hint={workflowGuardrailFields.usdcCap.hint}
                placeholder={workflowGuardrailFields.usdcCap.placeholder}
                error={capIssue('USDC', draft.usdcCap, spending.usdc)}
                change={(usdcCap) => update({ usdcCap })}
              />
              <Input
                name={workflowGuardrailFields.wethCap.label}
                value={draft.wethCap}
                hint={workflowGuardrailFields.wethCap.hint}
                placeholder={workflowGuardrailFields.wethCap.placeholder}
                error={capIssue('WETH', draft.wethCap, spending.weth)}
                change={(wethCap) => update({ wethCap })}
              />
              <Input
                name="Weekly USDC budget (optional)"
                value={draft.usdcWeeklyBudget}
                change={(usdcWeeklyBudget) => update({ usdcWeeklyBudget })}
                hint="Resets Monday 00:00 UTC. Blank means unlimited."
                error={weeklyError(draft.usdcWeeklyBudget, 'USDC')}
              />
              <Input
                name="Weekly WETH budget (optional)"
                value={draft.wethWeeklyBudget}
                change={(wethWeeklyBudget) => update({ wethWeeklyBudget })}
                hint="Resets Monday 00:00 UTC. Blank means unlimited."
                error={weeklyError(draft.wethWeeklyBudget, 'WETH')}
              />
              <Input
                name={workflowGuardrailFields.slippage.label}
                value={draft.slippage}
                hint={
                  draft.chain === UNICHAIN_MAINNET_CHAIN_ID
                    ? 'Required when a path swaps. At least 0.01% and at most 10%. On Unichain Mainnet, 1% or higher is recommended due to 24-hour Chainlink heartbeats and linear Uniswap V3 quoting; split large swaps across runs.'
                    : workflowGuardrailFields.slippage.hint
                }
                placeholder={workflowGuardrailFields.slippage.placeholder}
                error={slippageIssue(draft.slippage, hasSwap)}
                change={(slippage) => update({ slippage })}
              />
              <Input
                name={workflowGuardrailFields.expires.label}
                value={draft.expires}
                hint={workflowGuardrailFields.expires.hint}
                placeholder={workflowGuardrailFields.expires.placeholder}
                error={
                  draft.expires.trim()
                    ? fieldIssue(workflowGuardrailFields.expires, draft.expires)
                    : undefined
                }
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
            {hasInactivityPayout && !draft.once && (
              <p className="rb-inspector-error" role="alert">
                Enable &ldquo;Close after a confirmed run&rdquo; for an inactivity payout.
              </p>
            )}
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
                  if (next) {
                    const crossCapable = supportsCrossChain(next, hasDipBy);
                    update({
                      trigger: next,
                      ...(!crossCapable && draft.originChain !== draft.chain
                        ? { originChain: draft.chain }
                        : {}),
                    });
                  }
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
            {chains.length > 1 && supportsCrossChain(draft.trigger, hasDipBy) && (
              <V2Field
                name="Trigger network"
                hint={
                  draft.trigger === T.schedule
                    ? `Watch pool prices for the dip check on this network and settle on ${v2Network(draft.chain).name}.`
                    : `Watch pool prices or token transfers on this network and settle on ${v2Network(draft.chain).name}.`
                }
              >
                <Select
                  value={String(draft.originChain)}
                  groups={[
                    {
                      label: 'Origin networks',
                      options: chains.map((chainId) => ({
                        value: String(chainId),
                        label: v2Network(chainId).name,
                      })),
                    },
                  ]}
                  onChange={(nextValue) => {
                    const nextOrigin = Number(nextValue);
                    if (isFundsChain(nextOrigin)) {
                      update({ originChain: nextOrigin as FundsChainId });
                    }
                  }}
                />
              </V2Field>
            )}
            {paymentConflictCallout}
            <div className="rb-inspector-fields">
              {draft.trigger === T.schedule && (
                <Input
                  name={workflowGuardrailFields.interval.label}
                  value={draft.interval}
                  hint={workflowGuardrailFields.interval.hint}
                  placeholder={workflowGuardrailFields.interval.placeholder}
                  error={
                    draft.interval.trim()
                      ? fieldIssue(workflowGuardrailFields.interval, draft.interval)
                      : undefined
                  }
                  change={(interval) => update({ interval })}
                />
              )}
              {draft.trigger === T.transfer && (
                <Input
                  name={workflowFieldSpecs.token.label}
                  value={draft.source}
                  hint={workflowFieldSpecs.token.hint}
                  placeholder={workflowFieldSpecs.token.placeholder}
                  error={
                    draft.source.trim()
                      ? fieldIssue(workflowFieldSpecs.token, draft.source)
                      : undefined
                  }
                  change={(source) => update({ source })}
                  text
                />
              )}
              {(draft.trigger === T.transfer || (draft.trigger === T.payment && hasPaymentFrom)) &&
                (() => {
                  const subjectRequired =
                    (hasPaymentFrom && draft.trigger === T.payment) ||
                    (draft.trigger === T.transfer && draft.originChain !== draft.chain);
                  const subjectInput = (
                    <Input
                      name="Watched wallet address"
                      value={draft.subject}
                      hint={
                        hasPaymentFrom && draft.trigger === T.payment
                          ? 'Required for the Payment is from the specified wallet check.'
                          : draft.trigger === T.transfer && draft.originChain !== draft.chain
                            ? `Required when watching a transfer on ${v2Network(draft.originChain).name}.`
                            : 'Optional. Limits the live check to activity from this wallet.'
                      }
                      placeholder="0x…"
                      error={
                        draft.subject.trim()
                          ? addressIssue(draft.subject, { noun: 'a watched wallet address' })
                          : subjectRequired
                            ? 'Enter a watched wallet address.'
                            : undefined
                      }
                      change={(subject) => update({ subject })}
                      text
                    />
                  );
                  return subjectRequired ? (
                    subjectInput
                  ) : (
                    <details className="rb-advanced">
                      <summary>Live check settings</summary>
                      <div className="rb-inspector-fields">{subjectInput}</div>
                    </details>
                  );
                })()}
            </div>
          </div>
        </>
      );

    if (!selectedEntry) return null;
    const path = selectedEntry.path;
    const changePath = (next: DraftPath) => update({ root: replacePath(draft.root, path, next) });

    if ('check' in path) {
      const metadata = checks[path.check];
      const conditionTriggerIssue = unavailable({ group: 'check', code: path.check }, draft);
      // The Vault evaluates transfer-triggered price checks against the settlement pool.
      const priceChain =
        draft.trigger === T.price || draft.trigger === T.schedule ? draft.originChain : draft.chain;
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
            {conditionTriggerIssue && (
              <p className="rb-inspector-error" role="alert">
                {conditionTriggerIssue}
              </p>
            )}
            <div className="rb-inspector-fields">
              {path.check === C.paymentFrom && (
                <Input
                  name="Watched wallet address"
                  value={draft.subject}
                  hint="Required. The sender wallet that satisfies this check."
                  placeholder="0x…"
                  error={
                    draft.subject.trim()
                      ? addressIssue(draft.subject, { noun: 'a watched wallet address' })
                      : hasPaymentFrom && draft.trigger === T.payment
                        ? 'Enter a watched wallet address.'
                        : undefined
                  }
                  change={(subject) => update({ subject })}
                  text
                />
              )}
              {metadata.decimals !== undefined && (
                <Input
                  name={`${metadata.name} threshold`}
                  value={path.value}
                  hint="The value this condition compares against."
                  assist={
                    isPriceCheckThreshold(path.check) && isFundsChain(priceChain) ? (
                      <PoolPriceAssist
                        chain={priceChain}
                        value={path.value}
                        onSelect={(value) => changePath({ ...path, value })}
                      />
                    ) : undefined
                  }
                  error={
                    path.value.trim()
                      ? amountIssue(path.value, checkThresholdRules(path.check, draft.trigger))
                      : undefined
                  }
                  change={(value) => changePath({ ...path, value })}
                />
              )}
              {metadata.upper && (
                <Input
                  name={metadata.upper}
                  value={path.upper}
                  hint={
                    path.check === C.priceOutside
                      ? 'Must be above the lower price.'
                      : 'Optional starting reference price.'
                  }
                  assist={
                    isPriceCheckUpper(path.check) && isFundsChain(priceChain) ? (
                      <PoolPriceAssist
                        chain={priceChain}
                        value={path.upper}
                        onSelect={(upper) => changePath({ ...path, upper })}
                      />
                    ) : undefined
                  }
                  required={path.check === C.priceOutside}
                  error={
                    path.upper.trim()
                      ? path.check === C.priceOutside
                        ? priceOutsideUpperIssue(path.value, path.upper)
                        : amountIssue(path.upper, checkUpperRules(path.check))
                      : undefined
                  }
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
        const stepContextIssue =
          step.kind === A.refill && !selectedEntry.activeChecks.has(C.usdcBelow)
            ? 'Refill Vault USDC must be inside the Yes branch of a Vault USDC is below check.'
            : step.kind === A.inactivityPayout && !selectedEntry.activeChecks.has(C.inactivity)
              ? 'Send inactivity payout must be inside the Yes branch of a Wallet was inactive for check.'
              : step.kind === A.inactivityPayout && path.steps.length !== 1
                ? 'Send inactivity payout cannot be combined with other actions on the same path.'
                : step.kind === A.inactivityPayout && !draft.once
                  ? 'Enable "Close after a confirmed run" for an inactivity payout.'
                  : step.kind !== A.inactivityPayout &&
                      step.kind !== A.alert &&
                      selectedEntry.activeChecks.has(C.inactivity)
                    ? 'Only a single inactivity payout can run inside the Yes branch of an inactivity check.'
                    : (step.kind === A.buy || step.kind === A.sell) &&
                        path.steps.filter((item) => item.kind === A.buy || item.kind === A.sell)
                          .length > 1
                      ? 'A single path can include at most one buy or sell action.'
                      : undefined;
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
              {stepContextIssue && (
                <p className="rb-inspector-error" role="alert">
                  {stepContextIssue}
                </p>
              )}
              {(metadata.asset || metadata.recipient) && (
                <div className="rb-inspector-fields">
                  {metadata.asset && (
                    <>
                      {(draft.trigger === T.payment || step.unit === U.percent) &&
                        (step.kind === A.send || step.kind === A.buy) && (
                          <V2Field
                            name="Amount type"
                            error={
                              step.unit === U.percent && draft.trigger !== T.payment
                                ? 'Percent of payment requires the Vault receives USDC trigger.'
                                : undefined
                            }
                          >
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
                        hint={
                          step.unit === U.percent
                            ? 'A share of the incoming payment.'
                            : `${metadata.asset} is spent from your vault.`
                        }
                        error={
                          step.amount.trim()
                            ? amountIssue(step.amount, stepAmountRules(step.kind, step.unit))
                            : undefined
                        }
                        change={(amount) => updateStep({ ...step, amount })}
                      />
                    </>
                  )}
                  {metadata.recipient && (
                    <Input
                      name="Recipient address"
                      value={step.recipient}
                      hint="A wallet other than your vault."
                      placeholder="0x…"
                      error={
                        step.recipient.trim()
                          ? addressIssue(step.recipient, {
                              noun: 'a recipient address',
                              ...(vault
                                ? {
                                    disallowed: vault,
                                    disallowedMessage: 'Choose a wallet other than your vault.',
                                  }
                                : {}),
                            })
                          : undefined
                      }
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
                No path can accept this node.{' '}
                {selected.group === 'action' &&
                (selected.code === A.buy || selected.code === A.sell)
                  ? 'A path can include at most one buy or sell action, and at most three steps.'
                  : selected.group === 'action' && selected.code === A.refill
                    ? 'Add Refill Vault USDC inside the Yes branch of a Vault USDC is below check.'
                    : selected.group === 'action' && selected.code === A.inactivityPayout
                      ? 'Add Send inactivity payout to an empty Yes branch of a Wallet was inactive for check.'
                      : 'Change the trigger or remove a step first.'}
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
      {isMainnet && !isDeploymentConfigured && (
        <MainnetUnavailableCallout context="Workflow creation" />
      )}
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
              <WorkflowProgramSummary draft={draft} weekly={budget} />
            </div>
          </section>

          <aside className="app-panel rb-activation" aria-label="Activation">
            <div className="rb-panel-head">
              <div>
                <h2 className="rb-panel-title">Activate</h2>
                <p className="rb-panel-copy">
                  Confirm the authorization and enable the workflow on {automationName}.
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
                {budget && (
                  <div>
                    <dt>Weekly budget</dt>
                    <dd>
                      {weeklyLabel(budget.usdc, 6, 'USDC')} · {weeklyLabel(budget.weth, 18, 'WETH')}
                    </dd>
                  </div>
                )}
              </dl>
              {capReached && (
                <Callout title="All workflow slots are in use">
                  <p>
                    This wallet already has {workflowV2Limits.activePerAgent} active workflows.
                    Pause or complete one before activating this workflow; an Agent can watch{' '}
                    {workflowV2Limits.activePerAgent} at a time.
                  </p>
                </Callout>
              )}
              {paymentConflictCallout}
              {hasPayout && (
                <label className="rb-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  Authorize the fixed payout after the grace and final confirmation periods.
                </label>
              )}
              {(!settlementFactory(draft.chain as SettlementChain) ||
                !workflowActivationEnabled) && (
                <p className="rb-alert">
                  {isMainnet && !isDeploymentConfigured
                    ? 'Mainnet activation is unavailable until Mainnet contracts are deployed.'
                    : `${isMainnet ? 'Mainnet' : 'Testnet'} activation is disabled.`}
                </p>
              )}
              {(() => {
                const checkingAccount = Boolean(
                  wallet.owner && isDeploymentConfigured && linkedAccount.isPending,
                );
                const accountCheckError = Boolean(
                  wallet.owner && isDeploymentConfigured && linkedAccount.isError,
                );
                const needsInitialSetup = Boolean(
                  wallet.owner &&
                  isDeploymentConfigured &&
                  !linkedAccount.isPending &&
                  !linkedAccount.isError &&
                  linkedAccount.linked === null,
                );
                const returnParams = new URLSearchParams(location.search);
                returnParams.delete('network');
                returnParams.set('review', '1');
                const setupLink = setupHref({
                  next: `${location.pathname}?${returnParams.toString()}`,
                  chain: draft.chain as FundsChainId,
                  mode,
                });

                return (
                  <>
                    {workflowActivationEnabled && checkingAccount && (
                      <Spinner label="Checking your account…" />
                    )}
                    {workflowActivationEnabled && accountCheckError && (
                      <Callout
                        title="Could not check your account"
                        action={
                          <Button
                            disabled={linkedAccount.isFetching}
                            onClick={() => void linkedAccount.refetch()}
                          >
                            {linkedAccount.isFetching ? 'Checking…' : 'Check again'}
                          </Button>
                        }
                      >
                        <p>Activation is paused until your account status can be read.</p>
                      </Callout>
                    )}
                    {workflowActivationEnabled && needsInitialSetup && (
                      <Callout title="Set up your account before activating">
                        <p>
                          Create your {automationName} automation account and{' '}
                          {v2Network(draft.chain).name} Vault first. Your workflow draft is saved
                          and will be ready to activate when you return.
                        </p>
                      </Callout>
                    )}
                    {workflowActivationEnabled &&
                      !checkingAccount &&
                      !accountCheckError &&
                      !needsInitialSetup && (
                        <WorkflowCreditNotice
                          owner={wallet.owner}
                          review
                          chain={draft.chain as SettlementChain}
                        />
                      )}
                    {workflowActivationEnabled &&
                      !checkingAccount &&
                      !accountCheckError &&
                      !needsInitialSetup && (
                        <WorkflowFundingNotice
                          owner={wallet.owner}
                          funding={funding}
                          onEdit={() => review(undefined)}
                        />
                      )}
                    {!wallet.owner ? (
                      <WalletControl setup />
                    ) : needsInitialSetup && workflowActivationEnabled ? (
                      <Link className="app-button app-button--primary rb-full" to={setupLink}>
                        Set up account to activate
                      </Link>
                    ) : (
                      <button
                        className="app-button app-button--primary rb-full"
                        type="button"
                        disabled={
                          wallet.busy ||
                          checkingAccount ||
                          accountCheckError ||
                          !workflowActivationEnabled ||
                          !settlementFactory(draft.chain as SettlementChain) ||
                          !budget ||
                          funding.blocked ||
                          capReached ||
                          Boolean(paymentConflict) ||
                          (hasPayout && !consent)
                        }
                        onClick={async () => {
                          if (!budget) return;
                          if (
                            await wallet.activate(workflowId, draft.title.trim(), program, budget)
                          ) {
                            try {
                              localStorage.removeItem(storageKey);
                            } catch {
                              /* The chain transaction is confirmed. */
                            }
                            navigate(
                              withNetworkQuery(
                                `/workflows/${workflowId}?chain=${draft.chain}`,
                                mode,
                              ),
                            );
                          }
                        }}
                      >
                        Activate workflow
                      </button>
                    )}
                    <p className="rb-activation-note">
                      {needsInitialSetup
                        ? `Account setup adds the required networks, creates your ${automationName} agent and ${v2Network(draft.chain).name} vault, and lets you fund them before activating.`
                        : `Your wallet approves vault authorization on ${v2Network(draft.chain).name} and activation on ${automationName}.`}
                    </p>
                  </>
                );
              })()}
              <V2Feedback wallet={wallet} />
            </div>
          </aside>
        </div>
      ) : (
        <div className="rb-builder">
          <section className="rb-canvas-panel" aria-label="Workflow graph">
            <div className="rb-canvas-toolbar">
              <h2 className="rb-panel-title">Canvas</h2>
              <div className="rb-action-row">
                <button
                  type="button"
                  className="app-button app-button--quiet"
                  onClick={() => setRulewrightOpen(true)}
                >
                  <HugeiconsIcon icon={SparklesIcon} size={14} aria-hidden="true" />
                  Ask Rulewright
                </button>
                <button
                  type="button"
                  className="app-button app-button--quiet"
                  onClick={showWorkflow}
                >
                  <HugeiconsIcon icon={Settings02Icon} size={15} aria-hidden="true" />
                  Workflow settings
                </button>
              </div>
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
      {rulewrightOpen && (
        <RulewrightDialog
          key={`${mode}:${address ?? 'disconnected'}`}
          draft={id || hasRulewrightBaseline(draft, mode) ? draft : undefined}
          lockChain={Boolean(id)}
          session={rulewrightSession}
          close={() => setRulewrightOpen(false)}
          summary={(next) => <WorkflowProgramSummary draft={next} />}
          apply={(next) => {
            const normalizedNext =
              id && next.chain !== draft.chain
                ? {
                    ...next,
                    chain: draft.chain,
                    originChain:
                      supportsCrossChain(next.trigger, draftHasCheck(next, C.dipBy)) &&
                      networkModeForChain(next.originChain) === networkModeForChain(draft.chain)
                        ? next.originChain
                        : draft.chain,
                  }
                : next;
            const pathShape = ({ paths }: ReturnType<typeof diagramV2>) =>
              paths.map(({ path, anchor }) => [anchor, 'steps' in path ? path.steps.length : null]);
            if (
              JSON.stringify(pathShape(diagram)) !==
              JSON.stringify(pathShape(diagramV2(normalizedNext)))
            )
              setPositions({});
            update(normalizedNext);
            setRecipes(false);
            setRulewrightOpen(false);
            pick(undefined);
            showWorkflow();
            setStatus('Rulewright draft applied. Review the workflow when you’re ready.');
          }}
        />
      )}
      {program && !error && <span className="sr-only">{formatWorkflowCaps(program)}</span>}
    </section>
  );
}
