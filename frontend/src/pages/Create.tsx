import { ArrowRight02Icon, LockKeyIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  agentAbi,
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
import { AccountFunding, useExecutionCredit } from '../components/AccountFunding.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { ScheduleLabel } from '../components/ScheduleLabel.js';
import { useCreateRule } from '../hooks/useCreateRule.js';
import { useAccountSetup } from '../hooks/useAccountSetup.js';
import { useSetupWallet } from '../hooks/useSetupWallet.js';
import { appRoutes } from '../lib/routes.js';
import { formatRuleSentence } from '../lib/rules.js';
import { CreateAccount } from './CreateAccount.js';
import '../styles/composer.css';

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
  const { address } = useAccount();
  const owner = address?.toLowerCase() as Address | undefined;
  const setup = useAccountSetup({ owner, wallet: useSetupWallet() });
  const { agent, vault, linked } = setup.data ?? {};

  return (
    <section className="app-page">
      <PageHeading
        title="Compose a rule"
        description="Fill in a sentence to tell Rulebook what to do and when."
        breadcrumb={
          <>
            <Link to={appRoutes.rules}>Rules</Link>
            <HugeiconsIcon icon={ArrowRight02Icon} size={12} aria-hidden="true" />
            <span aria-current="page">Composer</span>
          </>
        }
      />
      {agent && vault && linked ? (
        <FirstRule agent={agent} vault={vault} />
      ) : setup.isLoading ? (
        <div className="app-skeleton h-32 animate-pulse" role="status">
          <span className="sr-only">Looking for your automation account…</span>
        </div>
      ) : setup.error ? (
        <ErrorState
          message="Your automation account could not be loaded."
          detail={setup.error.message}
          onRetry={() => void setup.refetch()}
        />
      ) : (
        <CreateAccount setup={setup} />
      )}
    </section>
  );
}

function FirstRule({ agent, vault }: { agent: Address; vault: Address }) {
  const rules = useReadContract({
    address: agent,
    abi: agentAbi,
    functionName: 'getRuleIds',
    chainId: LASNA_CHAIN_ID,
  });
  const credits = useExecutionCredit(agent, vault);
  const [showFunding, setShowFunding] = useState(false);
  const first = rules.data?.length === 0;
  const suggested = !credits.watching.data
    ? 'watching'
    : !credits.execution.data
      ? 'execution'
      : 'vault';
  return (
    <>
      {first && (
        <div className="app-panel app-panel-pad space-y-3">
          <h2 className="app-panel-heading">Before your first rule runs</h2>
          <p className="app-copy">
            Fund monitoring on Lasna and execution on Unichain Sepolia. Add USDC to your vault for
            rules that spend USDC.
          </p>
          {credits.watching.data === 0n && (
            <p className="app-copy">Add REACT to start monitoring your rules.</p>
          )}
          {credits.execution.data === 0n && (
            <p className="app-copy">Add ETH to run trades and transfers.</p>
          )}
          <button
            type="button"
            className="app-button"
            aria-expanded={showFunding}
            onClick={() => setShowFunding((shown) => !shown)}
          >
            {showFunding ? 'Hide funding' : 'Add funds'}
          </button>
        </div>
      )}
      {first && showFunding && (
        <AccountFunding
          agent={agent}
          vault={vault}
          suggested={suggested}
          onConfirmed={() =>
            void Promise.all([credits.watching.refetch(), credits.execution.refetch()])
          }
        />
      )}
      <CreateRuleForm agent={agent} />
    </>
  );
}
