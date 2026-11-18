import { ArrowRight02Icon, LockKeyIcon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  agentFactoryAbi,
  getTemplate,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type SlotKey,
  type TemplateId,
} from '@rulebook/shared';
import { useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAccount, useReadContract } from 'wagmi';

import { LiveCalldata } from '../composer/LiveCalldata.js';
import { SentenceCanvas } from '../composer/SentenceCanvas.js';
import { TemplatePicker } from '../composer/TemplatePicker.js';
import { composerReducer, initialComposerState, toReadyDraft } from '../composer/reducer.js';
import { slotIssues } from '../composer/validation.js';
import { CreateSuccess } from '../components/CreateSuccess.js';
import { EmptyState } from '../components/chrome/EmptyState.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { ScheduleLabel } from '../components/ScheduleLabel.js';
import { useCreateRule } from '../hooks/useCreateRule.js';
import { AGENT_FACTORY_ADDRESS } from '../lib/contracts.js';
import { appRoutes } from '../lib/routes.js';
import { formatRuleSentence } from '../lib/rules.js';
import '../styles/composer.css';

const ZERO = '0x0000000000000000000000000000000000000000';

/** The composer itself, split from the account lookup so tests can render it with an agent. */
export function CreateRuleForm({
  agent,
  initialTemplate = 1,
}: {
  readonly agent: Address;
  readonly initialTemplate?: TemplateId;
}) {
  const [state, dispatch] = useReducer(
    composerReducer,
    initialComposerState(UNICHAIN_SEPOLIA_CHAIN_ID, initialTemplate),
  );
  const [submitted, setSubmitted] = useState(false);
  const [makePublic, setMakePublic] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { status, error, result, create, reset } = useCreateRule();

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
          <button type="submit" disabled={busy} className="rule-composer__submit">
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
            <span>Your funds stay in your vault. The operator pays execution costs.</span>
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
  const { address } = useAccount();
  const owner = (address?.toLowerCase() as Address | undefined) ?? ZERO;
  const agentQuery = useReadContract({
    address: AGENT_FACTORY_ADDRESS ?? ZERO,
    abi: agentFactoryAbi,
    functionName: 'agentOf',
    args: [owner],
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(address && AGENT_FACTORY_ADDRESS) },
  });
  const agent = agentQuery.data && agentQuery.data !== ZERO ? agentQuery.data : null;

  return (
    <section className="app-page">
      <PageHeading
        title="Compose a rule"
        description="Build an automation by filling in the sentence. Review it, then sign once."
        breadcrumb={
          <>
            <Link to={appRoutes.rules}>Rules</Link>
            <HugeiconsIcon icon={ArrowRight02Icon} size={12} aria-hidden="true" />
            <span aria-current="page">Composer</span>
          </>
        }
      />
      {agent ? (
        <CreateRuleForm agent={agent} />
      ) : !address ? (
        <EmptyState
          icon={Wallet01Icon}
          title="Connect the owner wallet"
          description="Use Connect wallet in the navigation to open your automation account."
        />
      ) : agentQuery.isLoading ? (
        <div className="app-skeleton h-32 animate-pulse" role="status">
          <span className="sr-only">Looking for your automation account…</span>
        </div>
      ) : agentQuery.error ? (
        <ErrorState
          message="Your automation account could not be loaded."
          detail={agentQuery.error.message}
          chainId={LASNA_CHAIN_ID}
          onRetry={() => void agentQuery.refetch()}
        />
      ) : (
        <EmptyState
          icon={Wallet01Icon}
          title="Set up your automation account"
          description="Create an account for this wallet before you compose your first rule."
          action={
            <Link to={appRoutes.account} className="app-button app-button--primary">
              Create your account
            </Link>
          }
        />
      )}
    </section>
  );
}
