import {
  decodeWorkflow,
  encodeWorkflow,
  workflowActionKinds,
  workflowActionLabels,
  workflowDraftSchema,
  workflowIdSchema,
  workflowLimits,
  workflowTriggerLabels,
  workflowTriggers,
  type WorkflowAction,
  type WorkflowDraft,
  type WorkflowListing,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { bytesToHex, type Hex } from 'viem';
import { z } from 'zod';
import { WalletControl } from '@/components/chrome/WalletControl';
import { PageHeading } from '@/components/chrome/PageHeading';
import { workflowApi } from './api';
import {
  getVaultProgram,
  readWorkflowProgram,
  readWorkflowState,
  readWorkflowTitle,
  useWorkflowAccountQuery,
  useWorkflowWallet,
  workflowDeploymentReady,
} from './chain';
import {
  WorkflowGraph,
  WorkflowOutline,
  type GraphSelection,
  type WorkflowNodePositions,
} from './Graph';
import { alertAction, removeCondition, replaceNode, sameWorkflowShape, starters } from './model';
import { verifyListing } from './listing';
import { WalletFeedback } from './Feedback';
import { NodeLibrary } from './NodeLibrary';
import {
  isTriggerNode,
  keepEditedStepPositions,
  keepStepPositions,
  placeLibraryNode,
  placementProblem,
  workflowPaths,
  type LibraryNode,
  type LibraryTarget,
} from './nodeLibraryModel';

export function WorkflowBuilder() {
  const { id: routeId } = useParams();
  const [params] = useSearchParams();
  const source = params.get('copy');
  const account = useWorkflowAccountQuery();
  const wallet = useWorkflowWallet();
  const idValidation = routeId ? workflowIdSchema.safeParse(routeId) : undefined;
  const id = idValidation?.success ? idValidation.data : undefined;
  const listing = useQuery({
    queryKey: ['workflow-listing', source],
    enabled: Boolean(source && !routeId),
    queryFn: async ({ signal }) => {
      if (!source) throw new Error('This listing link is invalid.');
      const item = await workflowApi.listing(source, signal);
      await verifyListing(item);
      return item;
    },
  });
  const original = useQuery({
    queryKey: ['workflow-edit', account.data?.agent, id],
    enabled: Boolean(id && account.data?.linked),
    queryFn: async () => {
      if (!id || !account.data?.linked) throw new Error('Connect the workflow owner’s wallet.');
      const { agent, vault } = account.data;
      const { entry, auth } = await readWorkflowState(agent, vault, id);
      if (entry[1] === 0n) throw new Error('This wallet does not own the workflow.');
      if (entry[6] || auth[4]) throw new Error('This workflow has been cancelled.');
      const name = await readWorkflowTitle(agent, id);
      const program =
        auth[1] > entry[1] && auth[3]
          ? await getVaultProgram(vault, auth[0])
          : await readWorkflowProgram(agent, entry[0]);
      return decodeWorkflow(program, name);
    },
  });

  if (idValidation && !idValidation.success)
    return <p role="alert">This workflow link is invalid.</p>;
  if (routeId && !wallet.owner)
    return (
      <div className="app-page">
        <PageHeading title="Edit workflow" />
        <WalletControl setup />
      </div>
    );
  if (routeId && account.isPending) return <p role="status">Reading your workflow account…</p>;
  if (routeId && !account.data?.linked)
    return <p role="alert">Connect the wallet that owns this workflow.</p>;
  if ((routeId && original.isPending) || (source && listing.isPending))
    return <p role="status">Loading the workflow…</p>;
  const error = original.error ?? listing.error;
  const recovered = Boolean(
    source &&
    listing.error &&
    !listing.data &&
    (localDraft('rulebook-workflow:' + (wallet.owner ?? 'browser') + ':copy-' + source) ||
      localDraft('rulebook-workflow:browser:copy-' + source)),
  );
  if (error && !recovered) return <p role="alert">{error.message}</p>;
  return (
    <Editor
      key={[
        wallet.owner ?? 'browser',
        id ?? 'new',
        source ?? '',
        params.get('template') ?? '',
      ].join(':')}
      id={id}
      original={original.data}
      listing={listing.data}
      copyId={source}
      recovered={recovered}
      template={params.get('template')}
      wallet={wallet}
    />
  );
}

function newId(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

const workflowNodePositionsSchema = z.record(
  z.object({ x: z.number().finite(), y: z.number().finite() }),
);

function localDraft(key: string, id?: Hex) {
  try {
    const source = localStorage.getItem(key);
    const saved = source ? JSON.parse(source) : null;
    const draft = workflowDraftSchema.safeParse(saved?.draft);
    const savedId = workflowIdSchema.safeParse(saved?.id);
    if (draft.success && savedId.success && (!id || savedId.data === id)) {
      const positions = workflowNodePositionsSchema.safeParse(saved.positions);
      return {
        draft: draft.data,
        id: savedId.data,
        copied: saved.copied !== false,
        saved: true,
        positions: positions.success ? positions.data : {},
      };
    }
  } catch {
    /* The editor continues when browser storage is unavailable. */
  }
  return undefined;
}

function readDraft(key: string, fallback: WorkflowDraft, id?: Hex) {
  return (
    localDraft(key, id) ?? {
      draft: fallback,
      id: id ?? newId(),
      copied: true,
      saved: false,
      positions: {},
    }
  );
}

function Editor({
  id,
  original,
  listing,
  copyId,
  recovered,
  template,
  wallet,
}: {
  id?: Hex;
  original?: WorkflowDraft;
  listing?: WorkflowListing;
  copyId: string | null;
  recovered: boolean;
  template: string | null;
  wallet: ReturnType<typeof useWorkflowWallet>;
}) {
  const navigate = useNavigate();
  const copy = listing ? decodeWorkflow(listing.program, listing.title, true) : undefined;
  const starter =
    starters.find((item) => item.id === template) ?? starters.find((item) => item.id === 'blank')!;
  const key =
    'rulebook-workflow:' +
    [wallet.owner ?? 'browser', id ?? (copyId ? 'copy-' + copyId : 'new-' + starter.id)].join(':');
  const browserKey =
    'rulebook-workflow:browser:' + (copyId ? 'copy-' + copyId : 'new-' + starter.id);
  const [initial] = useState(() => {
    const current = readDraft(key, original ?? copy ?? starter.draft, id);
    if (!id && wallet.owner && !current.saved) return readDraft(browserKey, current.draft);
    return current;
  });
  const [draft, setDraft] = useState(initial.draft);
  const [positions, setPositions] = useState<WorkflowNodePositions>(initial.positions);
  const [selected, select] = useState<GraphSelection>('trigger');
  const map = useRef<HTMLDivElement>(null);
  const settings = useRef<HTMLElement>(null);
  const libraryToggle = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<'library' | 'settings'>('library');
  const [libraryPath, setLibraryPath] = useState<number>();
  const [draggedTool, setDraggedTool] = useState<LibraryNode | null>(null);
  const [panelMessage, setPanelMessage] = useState<{ text: string; error?: boolean }>();
  const [listView, setListView] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [copyCredit, setCopyCredit] = useState(initial.copied);
  const [validation, setValidation] = useState<string>();

  function selectFromMap(selection: GraphSelection, focus = false) {
    select(selection);
    setPanel('settings');
    requestAnimationFrame(() => {
      const inspector = settings.current;
      const tools = inspector?.parentElement;
      if (
        inspector &&
        (focus ||
          (tools &&
            map.current &&
            tools.getBoundingClientRect().top > map.current.getBoundingClientRect().top))
      )
        inspector.focus();
    });
  }

  function openLibrary(path?: number, focus = false) {
    setPanel('library');
    setLibraryPath(path);
    setPanelMessage(undefined);
    if (focus) libraryToggle.current?.focus();
  }

  function addFromLibrary(kind: LibraryNode, target: LibraryTarget) {
    const result = placeLibraryNode(draft, kind, target);
    if (result.error) {
      setPanelMessage({ text: result.error, error: true });
      return;
    }
    if (
      result.notice &&
      !window.confirm(
        'Switching triggers changes what the conditions measure. Clear their thresholds and keep the paths?',
      )
    )
      return;
    if (!result.draft) return;
    setPositions((current) => keepStepPositions(current, draft, kind, target));
    setDraft(result.draft);
    setValidation(undefined);
    setPanelMessage(result.notice ? { text: result.notice } : undefined);
    selectFromMap(target.owner, true);
  }

  function addFromDrop(kind: LibraryNode, target?: LibraryTarget) {
    setDraggedTool(null);
    if (target) {
      addFromLibrary(kind, target);
      return;
    }
    const paths = workflowPaths(draft);
    if (!isTriggerNode(kind) && paths.length === 1 && paths[0]) {
      addFromLibrary(kind, { owner: paths[0].id });
    } else {
      setPanelMessage({
        text: isTriggerNode(kind)
          ? 'Drop a trigger on the current trigger to replace it.'
          : 'Drop on a highlighted path or step to choose where it goes.',
        error: true,
      });
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ id: initial.id, draft, copied: copyCredit, positions }),
      );
    } catch {
      /* The current draft remains editable in this tab. */
    }
  }, [key, initial.id, draft, copyCredit, positions]);

  function update(change: Partial<WorkflowDraft>) {
    setDraft((current) => ({ ...current, ...change }));
    setValidation(undefined);
    setPanelMessage(undefined);
  }

  function editSteps(owner: number, actions: WorkflowAction[]) {
    setPositions((current) => keepEditedStepPositions(current, draft, owner, actions));
    update({ nodes: replaceNode(draft, owner, { type: 'path', actions }).nodes });
  }

  function inspect() {
    try {
      encodeWorkflow(draft);
      setValidation(undefined);
      setReviewing(true);
    } catch (error) {
      setValidation(error instanceof Error ? error.message : 'Check this workflow.');
    }
  }

  async function activate() {
    const attributed =
      listing && copy && copyCredit && sameWorkflowShape(copy, draft) ? BigInt(listing.id) : 0n;
    if (!(await wallet.activate(initial.id, draft, attributed))) return;
    try {
      localStorage.removeItem(key);
      if (!id && readDraft(browserKey, starter.draft).id === initial.id)
        localStorage.removeItem(browserKey);
    } catch {
      /* The confirmed workflow is on-chain. */
    }
    navigate('/workflows/' + initial.id);
  }

  const node = selected === 'trigger' ? undefined : draft.nodes[selected];
  const nominated = listing && copy && copyCredit && sameWorkflowShape(copy, draft);
  return (
    <section className="app-page workflow-page workflow-builder">
      <PageHeading
        title={id ? 'Edit workflow' : 'Build a workflow'}
        description={
          id
            ? 'Your existing workflow runs until the Vault accepts the new version.'
            : 'Choose what starts it, then decide what happens.'
        }
      />
      {!id && !copyId && (
        <div className="workflow-starters" aria-label="Workflow starting points">
          {starters.map((item) => (
            <Link
              key={item.id}
              to={'/workflows/new?template=' + item.id}
              aria-current={item.id === starter.id ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
      {listing && (
        <p className="app-copy">
          Based on{' '}
          <Link className="app-link" to={'/marketplace/' + listing.id}>
            {listing.title}
          </Link>
          . Set your own recipients and spending limit.
          {nominated && (
            <button
              type="button"
              className="workflow-text-button"
              onClick={() => setCopyCredit(false)}
            >
              Remove Marketplace link
            </button>
          )}
        </p>
      )}
      {recovered && (
        <p className="app-copy" role="status">
          The source listing could not be verified. You can continue with your saved draft as your
          own workflow.
        </p>
      )}
      <div className="workflow-builder-toolbar">
        <Field label="Workflow name">
          <input
            className="app-input"
            maxLength={80}
            value={draft.title}
            onChange={(event) => update({ title: event.target.value })}
          />
        </Field>
        {!reviewing && (
          <button
            type="button"
            className="app-button workflow-library-shortcut"
            onClick={() => openLibrary(undefined, true)}
          >
            Add nodes
          </button>
        )}
        <button
          type="button"
          className="app-button workflow-view-toggle"
          aria-pressed={listView}
          onClick={() => setListView(!listView)}
        >
          {listView ? 'Show diagram' : 'Show outline'}
        </button>
        <button type="button" className="app-button app-button--primary" onClick={inspect}>
          Review workflow
        </button>
      </div>
      {validation && (
        <p className="workflow-error" role="alert">
          {validation}
        </p>
      )}
      {reviewing ? (
        <section className="workflow-review app-panel app-panel-pad" aria-label="Review workflow">
          <h2 className="app-panel-heading">{draft.title}</h2>
          <WorkflowOutline draft={draft} />
          <p className="app-copy">
            Limit of {draft.spendLimit || '0'} USDC per run. Swap slippage limit of{' '}
            {draft.slippage || '0'}%.
          </p>
          {draft.trigger === 'payment' && (
            <p className="app-copy">
              Any test USDC sent to your Vault can start this workflow, including a deposit you make
              yourself.
            </p>
          )}
          {draft.trigger === 'schedule' && (
            <p className="app-copy">
              The first available tick starts the schedule. Later runs may arrive a little after the
              selected time.
            </p>
          )}
          {draft.trigger === 'price' && (
            <p className="app-copy">
              The first pool update sets a baseline. The Vault checks the price again before running
              the selected path.
            </p>
          )}
          <p className="app-copy">
            You’ll approve the spending limit on Unichain Sepolia and enable the workflow on
            Reactive Lasna. Fund watching and execution credit under Account &amp; Vault.
          </p>
          <div className="workflow-actions">
            {!wallet.owner && <WalletControl setup />}
            {wallet.owner && (
              <button
                type="button"
                className="app-button app-button--primary"
                disabled={wallet.busy || !workflowDeploymentReady}
                onClick={() => void activate()}
              >
                {wallet.busy ? 'Waiting for confirmation…' : 'Activate workflow'}
              </button>
            )}
            <button
              type="button"
              className="app-button"
              disabled={wallet.busy}
              onClick={() => setReviewing(false)}
            >
              Back to editing
            </button>
          </div>
          {!workflowDeploymentReady && (
            <p className="app-copy">
              The workflow contracts need to be configured before you can activate.
            </p>
          )}
          <WalletFeedback wallet={wallet} />
        </section>
      ) : (
        <div className="workflow-workbench">
          <div className="workflow-workbench-map" ref={map}>
            {!listView && (
              <WorkflowGraph
                draft={draft}
                selected={selected}
                select={selectFromMap}
                positions={positions}
                onPositionsChange={(moved) => setPositions((current) => ({ ...current, ...moved }))}
                draggedTool={draggedTool}
                onToolDrop={addFromDrop}
              />
            )}
            <div className={listView ? '' : 'workflow-mobile-outline'}>
              <WorkflowOutline draft={draft} selected={selected} select={selectFromMap} />
            </div>
          </div>
          <aside className="workflow-settings" aria-label="Workflow tools">
            <div className="workflow-panel-tabs" role="group" aria-label="Builder panel">
              <button
                type="button"
                ref={libraryToggle}
                aria-pressed={panel === 'library'}
                onClick={() => openLibrary()}
              >
                Nodes
              </button>
              <button
                type="button"
                aria-pressed={panel === 'settings'}
                onClick={() => {
                  setPanel('settings');
                  setPanelMessage(undefined);
                }}
              >
                Settings
              </button>
            </div>
            {panelMessage && (
              <p
                className={panelMessage.error ? 'workflow-error' : 'app-copy'}
                role={panelMessage.error ? 'alert' : 'status'}
              >
                {panelMessage.text}
              </p>
            )}
            {panel === 'library' && (
              <NodeLibrary
                draft={draft}
                path={libraryPath}
                onAdd={addFromLibrary}
                onDrag={setDraggedTool}
              />
            )}
            <section
              ref={settings}
              tabIndex={-1}
              className="workflow-inspector"
              aria-label="Selected step settings"
              hidden={panel !== 'settings'}
            >
              {selected === 'trigger' || !node ? (
                <>
                  <h2>Trigger and limits</h2>
                  <Field label="Starts when">
                    <select
                      className="app-input"
                      value={draft.trigger}
                      onChange={(event) =>
                        addFromLibrary(event.target.value as WorkflowDraft['trigger'], {
                          owner: 'trigger',
                        })
                      }
                    >
                      {workflowTriggers.map((trigger) => (
                        <option key={trigger} value={trigger}>
                          {workflowTriggerLabels[trigger]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {draft.trigger === 'schedule' && (
                    <Field label="Interval in hours">
                      <input
                        className="app-input"
                        inputMode="numeric"
                        value={draft.intervalHours}
                        onChange={(event) => update({ intervalHours: event.target.value })}
                      />
                    </Field>
                  )}
                  {draft.trigger === 'price' && (
                    <>
                      <Field label="Crossing direction">
                        <select
                          className="app-input"
                          value={draft.rising ? 'up' : 'down'}
                          onChange={(event) => update({ rising: event.target.value === 'up' })}
                        >
                          <option value="down">Falls below</option>
                          <option value="up">Rises to or above</option>
                        </select>
                      </Field>
                      <Field label="Target price in USDC per WETH">
                        <input
                          className="app-input"
                          inputMode="decimal"
                          value={draft.price}
                          onChange={(event) => update({ price: event.target.value })}
                        />
                      </Field>
                    </>
                  )}
                  <Field label="Maximum USDC per run">
                    <input
                      className="app-input"
                      inputMode="decimal"
                      value={draft.spendLimit}
                      onChange={(event) => update({ spendLimit: event.target.value })}
                    />
                  </Field>
                  <Field label="Maximum swap slippage (%)">
                    <input
                      className="app-input"
                      inputMode="decimal"
                      value={draft.slippage}
                      onChange={(event) => update({ slippage: event.target.value })}
                    />
                  </Field>
                  <button type="button" className="app-button" onClick={() => select(0)}>
                    Edit the first path
                  </button>
                </>
              ) : (
                typeof selected === 'number' &&
                (node.type === 'condition' ? (
                  <>
                    <h2>Condition</h2>
                    <Field
                      label={
                        draft.trigger === 'payment'
                          ? 'Payment is at least (USDC)'
                          : 'Price is at least (USDC per WETH)'
                      }
                    >
                      <input
                        className="app-input"
                        value={node.amount}
                        inputMode="decimal"
                        onChange={(event) =>
                          update({
                            nodes: replaceNode(draft, selected, {
                              ...node,
                              amount: event.target.value,
                            }).nodes,
                          })
                        }
                      />
                    </Field>
                    <div className="workflow-actions">
                      <button type="button" className="app-button" onClick={() => select(node.yes)}>
                        Edit yes path
                      </button>
                      <button type="button" className="app-button" onClick={() => select(node.no)}>
                        Edit otherwise path
                      </button>
                    </div>
                    <button
                      type="button"
                      className="workflow-text-button"
                      onClick={() => {
                        if (!window.confirm('Remove this condition and both paths?')) return;
                        update({ nodes: removeCondition(draft, selected).nodes });
                        select('trigger');
                      }}
                    >
                      Remove condition
                    </button>
                  </>
                ) : (
                  <>
                    <h2>Path steps</h2>
                    {node.actions.length === 0 && (
                      <p className="app-copy">This path does nothing until you add a step.</p>
                    )}
                    {node.actions.map((action, index) => (
                      <ActionFields
                        key={index}
                        action={action}
                        index={index}
                        payment={draft.trigger === 'payment'}
                        swapAvailable={
                          !node.actions.some((step, i) => i !== index && step.kind === 'swap')
                        }
                        change={(next) =>
                          update({
                            nodes: replaceNode(draft, selected, {
                              type: 'path',
                              actions: node.actions.map((step, i) => (i === index ? next : step)),
                            }).nodes,
                          })
                        }
                        remove={() =>
                          editSteps(
                            selected,
                            node.actions.filter((_, i) => i !== index),
                          )
                        }
                        earlier={
                          index > 0
                            ? () => {
                                const actions = [...node.actions];
                                const [step] = actions.splice(index, 1);
                                if (!step) return;
                                actions.splice(index - 1, 0, step);
                                editSteps(selected, actions);
                              }
                            : undefined
                        }
                      />
                    ))}
                    <div className="workflow-actions">
                      {node.actions.length < workflowLimits.stepsPerPath && (
                        <button
                          type="button"
                          className="app-button"
                          onClick={() => openLibrary(selected, true)}
                        >
                          Add step
                        </button>
                      )}
                      {!placementProblem(draft, 'condition', { owner: selected }) && (
                        <button
                          type="button"
                          className="app-button"
                          onClick={() => addFromLibrary('condition', { owner: selected })}
                        >
                          Add condition
                        </button>
                      )}
                    </div>
                  </>
                ))
              )}
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="app-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ActionFields({
  action,
  index,
  payment,
  swapAvailable,
  change,
  remove,
  earlier,
}: {
  action: WorkflowAction;
  index: number;
  payment: boolean;
  swapAvailable: boolean;
  change: (value: WorkflowAction) => void;
  remove: () => void;
  earlier?: () => void;
}) {
  return (
    <fieldset className="workflow-action-fields">
      <legend>Step {index + 1}</legend>
      <Field label="Action">
        <select
          className="app-input"
          value={action.kind}
          onChange={(event) => {
            const kind = event.target.value as WorkflowAction['kind'];
            change(
              kind === 'alert'
                ? alertAction
                : { ...action, kind, recipient: kind === 'send' ? action.recipient : '' },
            );
          }}
        >
          {workflowActionKinds.map((kind) => (
            <option
              key={kind}
              value={kind}
              disabled={kind === 'swap' && !swapAvailable && action.kind !== 'swap'}
            >
              {workflowActionLabels[kind]}
            </option>
          ))}
        </select>
      </Field>
      {action.kind !== 'alert' && (
        <>
          {payment && (
            <Field label="Amount type">
              <select
                className="app-input"
                value={action.unit}
                onChange={(event) =>
                  change({
                    ...action,
                    unit: event.target.value === 'percent' ? 'percent' : 'fixed',
                  })
                }
              >
                <option value="fixed">Fixed USDC amount</option>
                <option value="percent">Percent of payment</option>
              </select>
            </Field>
          )}
          <Field label={action.unit === 'percent' ? 'Percent of payment' : 'Amount in USDC'}>
            <input
              className="app-input"
              inputMode="decimal"
              value={action.amount}
              onChange={(event) => change({ ...action, amount: event.target.value })}
            />
          </Field>
          {action.kind === 'send' && (
            <Field label="Recipient wallet">
              <input
                className="app-input"
                spellCheck={false}
                value={action.recipient}
                onChange={(event) => change({ ...action, recipient: event.target.value })}
              />
            </Field>
          )}
        </>
      )}
      <div className="workflow-actions">
        {earlier && (
          <button type="button" className="workflow-text-button" onClick={earlier}>
            Move step {index + 1} earlier
          </button>
        )}
        <button type="button" className="workflow-text-button" onClick={remove}>
          Remove step {index + 1}
        </button>
      </div>
    </fieldset>
  );
}
