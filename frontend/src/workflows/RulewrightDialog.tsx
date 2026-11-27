import {
  actions,
  checks,
  defaultFundsChainFor,
  draftHasCheck,
  emptyDraft,
  getChain,
  networkModeForChain,
  rulewrightFollowUpLimit,
  rulewrightPromptLimit,
  rulewrightSignIn,
  triggers,
  workflowV2Check,
  workflowV2Trigger,
  workflowV2Unit,
  type DraftPath,
  type NetworkMode,
  type RulewrightRequest,
  type RulewrightResult,
  type V2Draft,
} from '@rulebook/shared';
import {
  Alert02Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  LockKeyIcon,
  MessageQuestionIcon,
  PencilEdit01Icon,
  Shield01Icon,
  SparklesIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useAccount, useSignMessage } from 'wagmi';

import { MainnetUnavailableCallout } from '@/components/MainnetUnavailableCallout';
import { ApiError, api } from '@/lib/api';
import { isWalletRejection } from '@/lib/errors';
import { useNetworkMode } from '@/lib/networkMode';
import { Button, Callout } from '@/ui';

export type RulewrightSession = {
  owner: string;
  network: NetworkMode;
  token: string;
  expiresAt: number;
  demo?: boolean;
};

const queueWaitMs = 5 * 60_000;
const pollMs = 2000;

async function waitForDraft(id: string, token: string, signal: AbortSignal) {
  const deadline = AbortSignal.timeout(queueWaitMs);
  const pollSignal = AbortSignal.any([signal, deadline]);
  let failures = 0;
  while (!pollSignal.aborted) {
    try {
      const job = await api.rulewrightJob(id, token, pollSignal);
      if (job.status === 'complete') return job.result;
      failures = 0;
    } catch (cause) {
      if (signal.aborted || (cause instanceof ApiError && cause.status < 500) || ++failures >= 3)
        throw cause;
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }
  signal.throwIfAborted();
  throw new Error('This draft is taking longer than expected. Try again shortly.');
}

type Change = { field: string; before: string; after: string };

function normalizeCandidateDraft(
  candidate: V2Draft,
  baseline: V2Draft | undefined,
  lockChain: boolean,
): V2Draft {
  if (!lockChain || !baseline || candidate.chain === baseline.chain) return candidate;
  const crossChainAllowed =
    candidate.trigger === workflowV2Trigger.price ||
    candidate.trigger === workflowV2Trigger.transfer ||
    (candidate.trigger === workflowV2Trigger.schedule &&
      draftHasCheck(candidate, workflowV2Check.dipBy));
  const originChain =
    crossChainAllowed &&
    networkModeForChain(candidate.originChain) === networkModeForChain(baseline.chain)
      ? candidate.originChain
      : baseline.chain;
  return {
    ...candidate,
    chain: baseline.chain,
    originChain,
  };
}

function diffDraft(previous: V2Draft, next: V2Draft) {
  const fields = {
    title: 'Workflow name',
    chain: 'Settlement network',
    originChain: 'Trigger network',
    trigger: 'Trigger',
    interval: 'Schedule interval',
    expires: 'Expiry',
    source: 'Token contract',
    subject: 'Watched account',
    usdcCap: 'USDC per run',
    wethCap: 'WETH per run',
    usdcWeeklyBudget: 'Weekly USDC budget',
    wethWeeklyBudget: 'Weekly WETH budget',
    slippage: 'Maximum slippage',
    once: 'Run frequency',
  } as const;

  function display(draft: V2Draft, field: keyof typeof fields) {
    switch (field) {
      case 'chain':
      case 'originChain':
        return getChain(draft[field]).name;
      case 'trigger':
        return triggers[draft.trigger];
      case 'once':
        return draft.once ? 'Once' : 'Repeating';
      case 'interval':
        return draft.interval ? `${draft.interval} seconds` : 'Unset';
      case 'slippage':
        return draft.slippage ? `${draft.slippage}%` : 'Unset';
      case 'usdcWeeklyBudget':
        return draft[field] ? `${draft[field]} USDC` : 'Unlimited';
      case 'wethWeeklyBudget':
        return draft[field] ? `${draft[field]} WETH` : 'Unlimited';
      default:
        return draft[field] || 'Unset';
    }
  }

  const changes: Change[] = [];
  for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
    if (previous[field] !== next[field]) {
      changes.push({
        field: fields[field],
        before: display(previous, field),
        after: display(next, field),
      });
    }
  }

  function describe(node: DraftPath | undefined) {
    if (!node) return 'Absent';
    if ('check' in node)
      return [checks[node.check].name, node.value, node.upper && `to ${node.upper}`]
        .filter(Boolean)
        .join(' ');
    return (
      node.steps
        .map((step) => {
          const action = actions[step.kind];
          const unit = step.unit === workflowV2Unit.percent ? '% of payment' : action.asset;
          const amount = step.amount && `${step.amount} ${unit}`;
          return [action.name, amount, step.recipient].filter(Boolean).join(' ');
        })
        .join(' → ') || 'Skip the run'
    );
  }

  function diffNode(before: DraftPath | undefined, after: DraftPath | undefined, field: string) {
    const oldText = describe(before);
    const newText = describe(after);
    if (oldText !== newText) changes.push({ field, before: oldText, after: newText });
    const oldCheck = before && 'check' in before ? before : undefined;
    const newCheck = after && 'check' in after ? after : undefined;
    if (oldCheck || newCheck) {
      diffNode(oldCheck?.yes, newCheck?.yes, `${field} / Yes`);
      diffNode(oldCheck?.no, newCheck?.no, `${field} / Otherwise`);
    }
  }

  diffNode(previous.root, next.root, 'Workflow logic');
  return changes;
}

export function RulewrightDialog({
  draft,
  lockChain = false,
  session,
  close,
  apply,
  summary,
}: {
  draft?: V2Draft;
  lockChain?: boolean;
  session: RefObject<RulewrightSession | undefined>;
  close: () => void;
  apply: (next: V2Draft) => void;
  summary: (draft: V2Draft) => ReactNode;
}) {
  const titleId = useId();
  const { mode, isMainnet, isDeploymentConfigured } = useNetworkMode();
  const prevModeRef = useRef(mode);
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef<AbortController>(undefined);
  const { address, connector } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const availability = useQuery({
    queryKey: ['rulewright-availability', mode],
    queryFn: ({ signal }) => api.rulewrightAvailability(signal, mode),
    enabled: isDeploymentConfigured,
    retry: false,
  });
  const [verified, setVerified] = useState(session.current);
  const [busy, setBusy] = useState<'wallet' | 'draft'>();
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState<RulewrightRequest['followUps']>([]);
  const [preview, setPreview] = useState<{ result: RulewrightResult; baseline?: V2Draft }>();
  const [error, setError] = useState<string>();

  const activeSession =
    verified &&
    verified.network === mode &&
    verified.expiresAt * 1000 > Date.now() + queueWaitMs &&
    (address
      ? !verified.demo && verified.owner === address
      : Boolean(verified.demo && mode === 'testnet'))
      ? verified
      : undefined;
  const result = preview?.result;
  const candidateDraft =
    result?.type === 'draft' ? normalizeCandidateDraft(result.draft, draft, lockChain) : undefined;
  const question = result?.type === 'question' ? result.message : undefined;
  const stale = preview && preview.baseline !== draft;
  const changes = candidateDraft && draft ? diffDraft(draft, candidateDraft) : undefined;
  const step = candidateDraft ? 3 : question ? 2 : 1;

  useEffect(() => {
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    operation.current?.abort();
    operation.current = undefined;
    session.current = undefined;
    setVerified(undefined);
    setBusy(undefined);
    setPreview(undefined);
    setHistory([]);
    setAnswer('');
    setError(undefined);
  }, [mode, session]);

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      operation.current?.abort();
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  async function verify() {
    if (!address || !connector || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const { signal } = controller;
    setBusy('wallet');
    setError(undefined);
    try {
      const challenge = await api.rulewrightChallenge(address, signal, mode);
      if (
        challenge.origin !== window.location.origin ||
        challenge.owner !== address.toLowerCase() ||
        challenge.network !== mode
      ) {
        throw new Error('Rulewright received an unexpected wallet challenge.');
      }
      const signature = await signMessageAsync({
        connector,
        account: address,
        message: rulewrightSignIn(challenge),
      });
      if (signal.aborted) return;
      const response = await api.rulewrightSession(challenge.nonce, signature, signal);
      if (signal.aborted) return;
      const next = { owner: address, network: mode, ...response };
      session.current = next;
      setVerified(next);
    } catch (cause) {
      if (!signal.aborted)
        if (isWalletRejection(cause)) {
          setError('Wallet verification declined. Try again when you’re ready.');
        } else {
          setError(
            cause instanceof ApiError && cause.code !== 'http_error'
              ? cause.message
              : 'Wallet verification failed. Try again.',
          );
        }
    } finally {
      if (operation.current === controller) operation.current = undefined;
      if (!signal.aborted) setBusy(undefined);
    }
  }

  async function startDemoSession() {
    if (isMainnet || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const { signal } = controller;
    setBusy('wallet');
    setError(undefined);
    try {
      const response = await api.rulewrightDemoSession(signal, 'testnet');
      if (signal.aborted) return;
      const next: RulewrightSession = {
        owner: 'demo',
        network: 'testnet',
        demo: true,
        ...response,
      };
      session.current = next;
      setVerified(next);
    } catch (cause) {
      if (!signal.aborted) {
        setError(
          cause instanceof ApiError && cause.code !== 'http_error'
            ? cause.message
            : 'Demo drafting session could not be started. Try again.',
        );
      }
    } finally {
      if (operation.current === controller) operation.current = undefined;
      if (!signal.aborted) setBusy(undefined);
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    const text = (question ? answer : prompt).trim();
    if (
      !activeSession ||
      !text ||
      operation.current ||
      (question && history.length >= rulewrightFollowUpLimit)
    )
      return;
    const followUps = question ? [...history, { question, answer: text }] : [];
    const controller = new AbortController();
    operation.current = controller;
    const { signal } = controller;
    setBusy('draft');
    setError(undefined);
    try {
      const { id } = await api.rulewrightEnqueue(
        { prompt, followUps, draft, network: mode },
        activeSession.token,
        signal,
      );
      const next = await waitForDraft(id, activeSession.token, signal);
      if (signal.aborted) return;
      if (next.type === 'error') {
        setError(next.message);
        return;
      }
      setPreview({ result: next, baseline: draft });
      setHistory(followUps);
      setAnswer('');
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) {
        session.current = undefined;
        setVerified(undefined);
        if (activeSession.demo) {
          setError('Your demo session expired. Start a new demo session.');
          return;
        }
      }
      setError(
        cause instanceof Error && cause.name !== 'TimeoutError'
          ? cause.message
          : 'Rulewright did not respond. Try again.',
      );
    } finally {
      if (operation.current === controller) operation.current = undefined;
      if (!signal.aborted) setBusy(undefined);
    }
  }

  function editDescription() {
    setPreview(undefined);
    setHistory([]);
    setAnswer('');
    setError(undefined);
  }

  function renderContent() {
    if (isMainnet && !isDeploymentConfigured) {
      return <MainnetUnavailableCallout context="Rulewright" />;
    }
    if (availability.isPending) {
      return (
        <p className="rb-rulewright__notice" role="status">
          Checking Rulewright availability…
        </p>
      );
    }
    if (!availability.data?.available) {
      return (
        <div className="rb-rulewright__card" data-tone="muted">
          <span className="rb-rulewright__card-mark" aria-hidden="true">
            <HugeiconsIcon icon={Alert02Icon} size={18} strokeWidth={1.7} />
          </span>
          <p role="status">
            Rulewright is unavailable right now. You can build or edit the workflow on the canvas.
          </p>
        </div>
      );
    }
    if (!activeSession && !address) {
      if (availability.data?.demoAvailable && !isMainnet) {
        return (
          <Callout
            title="Try Rulewright without a wallet"
            action={
              <Button
                variant="primary"
                disabled={Boolean(busy)}
                onClick={() => void startDemoSession()}
              >
                Start demo drafting session
              </Button>
            }
          >
            <p>Generate a testnet workflow draft and preview it on the canvas.</p>
          </Callout>
        );
      }
      return (
        <div className="rb-rulewright__card">
          <span className="rb-rulewright__card-mark" aria-hidden="true">
            <HugeiconsIcon icon={Wallet01Icon} size={18} strokeWidth={1.7} />
          </span>
          <div className="rb-rulewright__card-copy">
            <h3>Wallet not connected</h3>
            <p>Connect your wallet from the workspace header, then reopen Rulewright.</p>
          </div>
        </div>
      );
    }
    if (!activeSession) {
      return (
        <div className="rb-rulewright__card">
          <span className="rb-rulewright__card-mark" aria-hidden="true">
            <HugeiconsIcon icon={Shield01Icon} size={18} strokeWidth={1.7} />
          </span>
          <div className="rb-rulewright__card-copy">
            <h3>Start a drafting session</h3>
            <p>Verify your wallet with an off-chain signature to start a drafting session.</p>
            <ul className="rb-rulewright__facts">
              <li>
                <HugeiconsIcon icon={LockKeyIcon} size={13} strokeWidth={1.8} aria-hidden="true" />
                Off-chain signature
              </li>
              <li>
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  size={13}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                No gas or approvals
              </li>
              <li>
                <HugeiconsIcon icon={Clock01Icon} size={13} strokeWidth={1.8} aria-hidden="true" />
                Expires in 20 minutes
              </li>
            </ul>
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={Boolean(busy)}
              onClick={() => void verify()}
            >
              Verify wallet
            </button>
          </div>
        </div>
      );
    }
    if (stale || result?.type === 'unsupported') {
      return (
        <div className="rb-rulewright__preview">
          <div className="rb-rulewright__card" data-tone="muted">
            <span className="rb-rulewright__card-mark" aria-hidden="true">
              <HugeiconsIcon icon={Alert02Icon} size={18} strokeWidth={1.7} />
            </span>
            <div className="rb-rulewright__card-copy">
              <p role="status">
                {stale
                  ? 'The canvas changed. Generate a new preview from the current workflow.'
                  : result?.type === 'unsupported' && result.message}
              </p>
            </div>
          </div>
          <div className="rb-rulewright__foot">
            <button type="button" className="app-button" onClick={editDescription}>
              <HugeiconsIcon icon={PencilEdit01Icon} size={14} aria-hidden="true" />
              Edit description
            </button>
          </div>
        </div>
      );
    }
    if (result?.type === 'draft') {
      return (
        <div className="rb-rulewright__preview">
          <header className="rb-rulewright__preview-head">
            <span className="rb-rulewright__card-mark" data-tone="accent" aria-hidden="true">
              <HugeiconsIcon icon={SparklesIcon} size={18} strokeWidth={1.7} />
            </span>
            <div className="rb-rulewright__card-copy">
              <span className="rb-rulewright__eyebrow">Draft ready</span>
              <h3>{changes ? 'Proposed changes' : result.draft.title}</h3>
              <p>
                {changes
                  ? `${changes.length} ${changes.length === 1 ? 'field' : 'fields'} will change on the canvas.`
                  : 'Review the draft before applying it to the canvas.'}
              </p>
            </div>
          </header>
          {changes ? (
            changes.length ? (
              <dl className="rb-rulewright__changes">
                {changes.map(({ field, before, after }) => (
                  <div key={field}>
                    <dt>{field}</dt>
                    <dd data-side="before">
                      <span>Before</span>
                      {before}
                    </dd>
                    <span className="rb-rulewright__change-arrow" aria-hidden="true">
                      <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
                    </span>
                    <dd data-side="after">
                      <span>After</span>
                      {after}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="rb-rulewright__notice">This draft has no changes to apply.</p>
            )
          ) : (
            <div className="rb-rulewright__summary">
              {candidateDraft ? summary(candidateDraft) : null}
            </div>
          )}
          <div className="rb-rulewright__foot">
            <button type="button" className="app-button" onClick={editDescription}>
              <HugeiconsIcon icon={PencilEdit01Icon} size={14} aria-hidden="true" />
              Edit description
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={!candidateDraft || changes?.length === 0}
              onClick={() => candidateDraft && apply(candidateDraft)}
            >
              Apply to canvas
            </button>
          </div>
        </div>
      );
    }
    if (question && history.length >= rulewrightFollowUpLimit) {
      return (
        <div className="rb-rulewright__preview">
          <p className="rb-rulewright__question" role="status">
            <span aria-hidden="true">
              <HugeiconsIcon icon={MessageQuestionIcon} size={16} strokeWidth={1.8} />
            </span>
            {question}
          </p>
          <p className="rb-rulewright__notice">
            Add the remaining details to your description and try again.
          </p>
          <div className="rb-rulewright__foot">
            <button type="button" className="app-button" onClick={editDescription}>
              Edit description
            </button>
          </div>
        </div>
      );
    }
    const descriptionExample = draft
      ? 'Change the schedule to every day.'
      : 'Buy 10 USDC of WETH every 6 hours. Cap each run at 10 USDC and limit slippage to 1%.';
    const value = question ? answer : prompt;
    return (
      <form className="rb-rulewright__form" onSubmit={(event) => void generate(event)}>
        {question ? (
          <p className="rb-rulewright__question" role="status">
            <span aria-hidden="true">
              <HugeiconsIcon icon={MessageQuestionIcon} size={16} strokeWidth={1.8} />
            </span>
            {question}
          </p>
        ) : (
          <p className="rb-rulewright__intro">
            Describe the trigger, actions, and guardrails. Rulewright returns a preview you can
            review before anything changes.
          </p>
        )}
        <label className="app-field">
          <span className="rb-rulewright__field-label">
            <span>{question ? 'Your answer' : 'Workflow description'}</span>
            <span className="rb-rulewright__count">
              {value.length} / {rulewrightPromptLimit}
            </span>
          </span>
          <textarea
            rows={question ? 3 : 5}
            maxLength={rulewrightPromptLimit}
            disabled={Boolean(busy)}
            value={value}
            onChange={(event) => (question ? setAnswer : setPrompt)(event.target.value)}
            placeholder={question ? undefined : descriptionExample}
          />
        </label>
        {!question && (
          <p className="rb-rulewright__privacy">
            <HugeiconsIcon icon={LockKeyIcon} size={13} strokeWidth={1.8} aria-hidden="true" />
            Gemini receives your description{draft ? ' and current draft' : ''} to prepare a
            preview.
          </p>
        )}
        <div className="rb-rulewright__foot">
          {question && (
            <button
              type="button"
              className="app-button"
              disabled={Boolean(busy)}
              onClick={editDescription}
            >
              Edit description
            </button>
          )}
          <button
            type="submit"
            className="app-button app-button--primary"
            disabled={Boolean(busy) || !value.trim()}
          >
            <HugeiconsIcon icon={SparklesIcon} size={14} aria-hidden="true" />
            Generate preview
          </button>
        </div>
      </form>
    );
  }

  const available = isDeploymentConfigured && availability.data?.available;
  const showSteps = Boolean(activeSession && available);

  return (
    <dialog
      ref={dialog}
      className="app-dialog app-panel rb-rulewright"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="rb-rulewright__header">
        <span className="rb-rulewright__mark" aria-hidden="true">
          <HugeiconsIcon icon={SparklesIcon} size={20} strokeWidth={1.6} />
        </span>
        <div className="rb-rulewright__heading">
          <span className="rb-rulewright__eyebrow">Drafting assistant</span>
          <h2 id={titleId} className="app-panel-heading">
            Rulewright
          </h2>
          <p>
            {draft
              ? 'Describe what you want to change.'
              : 'Describe the workflow you want to build.'}
          </p>
        </div>
        <button
          autoFocus
          type="button"
          className="app-button app-button--quiet app-icon-button rb-rulewright__close"
          aria-label="Close"
          onClick={close}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={17} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>

      {showSteps && (
        <div className="rb-rulewright__status">
          <ol className="rb-rulewright__steps" aria-label="Drafting progress">
            {['Describe', 'Review', 'Apply'].map((label, index) => {
              const position = index + 1;
              const state = position < step ? 'done' : position === step ? 'current' : 'todo';
              return (
                <li key={label} data-state={state}>
                  <span className="rb-rulewright__step-dot" aria-hidden="true">
                    {state === 'done' ? (
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2.2} />
                    ) : (
                      position
                    )}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>
          <span className="rb-rulewright__session">
            <span className="app-live-dot" aria-hidden="true" />
            {activeSession?.demo ? 'Demo session' : 'Session active'}
          </span>
        </div>
      )}

      <div className="rb-rulewright__body">{renderContent()}</div>

      {busy && (
        <p className="rb-rulewright__working" role="status">
          <span className="rb-rulewright__working-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {busy === 'wallet'
            ? address
              ? 'Confirm the signature in your wallet.'
              : 'Starting Rulewright demo session…'
            : 'Rulewright is drafting your workflow…'}
        </p>
      )}
      {error && (
        <p className="rb-rulewright__error" role="alert">
          <HugeiconsIcon icon={Alert02Icon} size={15} strokeWidth={1.8} aria-hidden="true" />
          {error}
        </p>
      )}
    </dialog>
  );
}

export function hasRulewrightBaseline(draft: V2Draft, mode: NetworkMode = 'testnet') {
  return JSON.stringify(draft) !== JSON.stringify(emptyDraft(defaultFundsChainFor(mode)));
}
