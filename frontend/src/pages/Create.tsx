import { ArrowRight02Icon, LockKeyIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  getTemplate,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type SlotKey,
  type TemplateId,
} from '@rulebook/shared';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router';

import { LiveCalldata } from '../composer/LiveCalldata.js';
import { SentenceCanvas } from '../composer/SentenceCanvas.js';
import { TemplatePicker } from '../composer/TemplatePicker.js';
import { composerReducer, initialComposerState, toReadyDraft } from '../composer/reducer.js';
import { useFirstRuleGuide } from '../composer/useFirstRuleGuide.js';
import { slotIssues } from '../composer/validation.js';
import { CreateSuccess } from '../components/CreateSuccess.js';
import { AppShell } from '../components/AppShell.js';
import { AccountSetupGate } from '../components/AccountSetupGate.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ScheduleLabel } from '../components/ScheduleLabel.js';
import { useCreateRule } from '../hooks/useCreateRule.js';
import { appRoutes } from '../lib/routes.js';
import { formatRuleSentence } from '../lib/rules.js';
import '../styles/composer.css';

/** The composer itself, split from the account lookup so tests can render it with an agent. */
export function CreateRuleForm({
  agent,
  initialTemplate = 1,
  onReview,
  onCreatedChange,
}: {
  readonly agent: Address;
  readonly initialTemplate?: TemplateId;
  readonly onReview?: () => void;
  readonly onCreatedChange?: (created: boolean) => void;
}) {
  const [state, dispatch] = useReducer(
    composerReducer,
    initialComposerState(UNICHAIN_SEPOLIA_CHAIN_ID, initialTemplate),
  );
  const [submitted, setSubmitted] = useState(false);
  const [makePublic, setMakePublic] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { status, error, result, create, reset } = useCreateRule();
  const created = !!result;
  useEffect(() => onCreatedChange?.(created), [created, onCreatedChange]);

  const draft = useMemo(() => toReadyDraft(state), [state]);
  const sentence = useMemo(() => safeSentence(state.template, state.slots), [state]);
  const issues = useMemo(() => slotIssues(state), [state]);
  const required = getTemplate(state.template)?.slots.filter((slot) => slot.required) ?? [];
  const complete = required.filter((slot) => !issues[slot.key]).length;
  const busy = status === 'simulating' || status === 'signing' || status === 'confirming';

  const setSlot = (key: SlotKey, value: string): void => {
    dispatch({ type: 'setSlot', key, value });
  };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    onReview?.();
    setSubmitted(true);
    const firstInvalid = Object.keys(issues)[0];
    if (firstInvalid) {
      const control = formRef.current?.querySelector<HTMLElement>(
        `[data-slot="${firstInvalid}"] select`,
      );
      control?.focus();
      return;
    }
    if (!draft) return;
    void create(agent, draft, makePublic);
  }

  if (result) {
    return (
      <CreateSuccess
        agent={agent}
        ruleId={result.ruleId}
        sentence={sentence}
        txHash={result.txHash}
        onCreateAnother={() => {
          dispatch({ type: 'reset' });
          setSubmitted(false);
          setMakePublic(false);
          reset();
        }}
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="rule-composer rule-composer__layout">
      <div className="rule-composer__editor">
        <TemplatePicker
          chainId={LASNA_CHAIN_ID}
          selected={state.template}
          onSelect={(template) => {
            dispatch({ type: 'selectTemplate', template });
            setSubmitted(false);
          }}
        />
        <SentenceCanvas
          template={state.template}
          issues={submitted ? issues : {}}
          slots={state.slots}
          setSlot={setSlot}
        >
          {state.slots.schedule ? <ScheduleLabel seconds={state.slots.schedule} /> : null}
        </SentenceCanvas>
      </div>

      <div className="rule-composer__review">
        <LiveCalldata
          agent={agent}
          draft={draft}
          makePublic={makePublic}
          complete={complete}
          required={required.length}
        />
        <div className="rule-composer__actions">
          <div className="rule-composer__publish">
            <input
              id="publish-rule"
              type="checkbox"
              checked={makePublic}
              onChange={(event) => setMakePublic(event.target.checked)}
              aria-describedby="publish-rule-description"
            />
            <div>
              <label htmlFor="publish-rule">Publish to the marketplace</label>
              <p id="publish-rule-description">
                Anyone can reuse this rule’s settings. Your vault, funds, and signing key stay
                private.
              </p>
            </div>
          </div>
          {error ? (
            <div role="alert" className="rule-composer__error">
              <p>{error.message}</p>
              {error.selector ? (
                <p className="font-mono text-[11px] text-ink-muted">selector {error.selector}</p>
              ) : null}
              <p className="text-xs text-ink-muted">
                {error.kind === 'simulation'
                  ? 'Nothing was sent. The simulation is free and runs before you sign.'
                  : error.kind === 'wallet'
                    ? 'The transaction was not created.'
                    : 'Wait for the Lasna receipt before assuming the rule exists.'}
              </p>
            </div>
          ) : null}
          <button
            id="review-create-rule"
            type="submit"
            disabled={busy}
            className="rule-composer__submit"
          >
            {status === 'simulating'
              ? 'Simulating…'
              : status === 'signing'
                ? 'Waiting for your signature…'
                : status === 'confirming'
                  ? 'Waiting for the Lasna receipt…'
                  : 'Review and create rule'}
            {!busy && <HugeiconsIcon icon={ArrowRight02Icon} size={18} aria-hidden="true" />}
          </button>
          <p className="rule-composer__footnote">
            <HugeiconsIcon icon={LockKeyIcon} size={15} aria-hidden="true" />
            <span>Your vault holds trading funds. You add network fees separately.</span>
          </p>
        </div>
      </div>
    </form>
  );
}

function safeSentence(template: number, slots: Record<string, string | undefined>): string {
  try {
    return formatRuleSentence({
      template,
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      slots: slots as Record<string, string>,
    });
  } catch {
    return '';
  }
}

/** `/create`: connect, find the owner's Agent, then compose. */
export function Create() {
  return (
    <AccountSetupGate>{({ agent }) => <Composer key={agent} agent={agent} />}</AccountSetupGate>
  );
}

function Composer({ agent }: { agent: Address }) {
  const guide = useFirstRuleGuide();
  const [created, setCreated] = useState(false);
  return (
    <AppShell>
      <section className="app-page">
        <PageHeading
          title="Compose a rule"
          description="Fill in a sentence to tell Rulebook what to do and when."
          focusOnMount
          aside={
            !created && (
              <button
                ref={guide.replayButton}
                type="button"
                className="app-button"
                onClick={guide.start}
              >
                Rule composer guide
              </button>
            )
          }
          breadcrumb={
            <>
              <Link to={appRoutes.rules}>Rules</Link>
              <HugeiconsIcon icon={ArrowRight02Icon} size={12} aria-hidden="true" />
              <span aria-current="page">Composer</span>
            </>
          }
        />
        <CreateRuleForm agent={agent} onReview={guide.stop} onCreatedChange={setCreated} />
      </section>
    </AppShell>
  );
}
