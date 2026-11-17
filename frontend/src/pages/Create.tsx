import {
  agentFactoryAbi,
  LASNA_CHAIN_ID,
  readableSentence,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type SlotKey,
  type TemplateId,
} from '@rulebook/shared';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';

import { ChipPalette } from '../composer/ChipPalette.js';
import { LiveCalldata } from '../composer/LiveCalldata.js';
import { SentenceCanvas } from '../composer/SentenceCanvas.js';
import { TemplatePicker } from '../composer/TemplatePicker.js';
import {
  canSign,
  composerReducer,
  initialComposerState,
  toReadyDraft,
} from '../composer/reducer.js';
import type { SlotIssues } from '../composer/types.js';
import { slotIssues } from '../composer/validation.js';
import { CreateSuccess } from '../components/CreateSuccess.js';
import { ScheduleLabel } from '../components/ScheduleLabel.js';
import { useCreateRule } from '../hooks/useCreateRule.js';
import { AGENT_FACTORY_ADDRESS } from '../lib/contracts.js';

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
  const [issues, setIssues] = useState<SlotIssues>({});
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { status, error, result, create, reset } = useCreateRule();

  const draft = useMemo(() => toReadyDraft(state), [state]);
  const sentence = useMemo(() => safeSentence(state.template, state.slots), [state]);

  useEffect(() => {
    if (submitted) setIssues(slotIssues(state));
  }, [state, submitted]);

  const setSlot = (key: SlotKey, value: string): void => {
    dispatch({ type: 'setSlot', key, value });
  };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitted(true);
    const found = slotIssues(state);
    setIssues(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      const control = formRef.current?.querySelector<HTMLElement>(
        `[data-slot="${firstInvalid}"] select`,
      );
      control?.focus();
      return;
    }
    if (!draft) return;
    void create(agent, draft);
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
          setIssues({});
          reset();
        }}
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      <TemplatePicker
        chainId={LASNA_CHAIN_ID}
        selected={state.template}
        onSelect={(template) => {
          dispatch({ type: 'selectTemplate', template });
          setIssues({});
          setSubmitted(false);
        }}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <SentenceCanvas
            template={state.template}
            issues={issues}
            slots={state.slots}
            setSlot={setSlot}
          />
          <ChipPalette template={state.template} />
          {state.slots.schedule ? <ScheduleLabel seconds={state.slots.schedule} /> : null}
        </div>

        <div className="space-y-4">
          <LiveCalldata agent={agent} draft={draft} />
          {error ? (
            <div role="alert" className="space-y-1 rounded border border-silent/40 bg-silent/5 p-3">
              <p className="text-sm text-ink">{error.message}</p>
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
            type="submit"
            disabled={status === 'simulating' || status === 'signing' || status === 'confirming'}
            className="w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-surface disabled:opacity-50"
          >
            {status === 'simulating'
              ? 'Simulating…'
              : status === 'signing'
                ? 'Waiting for your signature…'
                : status === 'confirming'
                  ? 'Waiting for the Lasna receipt…'
                  : 'Sign once and create rule'}
          </button>
          <p className="text-xs text-ink-muted">
            One Lasna signature creates the rule. The operator pays the execution cost; your
            principal stays in your own vault.
          </p>
          {!canSign(state) ? (
            <p className="text-xs text-ink-muted">Some blanks are still empty.</p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function safeSentence(template: number, slots: Record<string, string | undefined>): string {
  try {
    return readableSentence({
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

  if (!address) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold text-ink">Compose a rule</h1>
        <p className="text-ink-muted">Connect the wallet that owns your automation account.</p>
      </section>
    );
  }

  if (agentQuery.isLoading) {
    return <p className="text-sm text-ink-muted">Looking for your automation account…</p>;
  }

  if (!agent) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold text-ink">Compose a rule</h1>
        <p className="text-ink-muted">
          You need an automation account before you can create a rule.
        </p>
        <a href="/account" className="text-sm text-automation underline">
          Create your account
        </a>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink">Compose a rule</h1>
        <p className="text-ink-muted">
          Choose values for each blank. You read the sentence, then sign once.
        </p>
      </header>
      <CreateRuleForm agent={agent} />
    </section>
  );
}
