import { ArrowRight02Icon, LockKeyIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  getTemplate,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  type Address,
  type SlotKey,
  type TemplateId,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router';

import { LiveCalldata } from '../composer/LiveCalldata.js';
import { RuleFields } from '../composer/RuleFields.js';
import { TemplatePicker } from '../composer/TemplatePicker.js';
import { composerReducer, initialComposerState } from '../composer/reducer.js';
import type { ComposerState, VaultTerms } from '../composer/types.js';
import type { RuleReplacement } from '../composer/replaceRule.js';
import { useFirstRuleGuide } from '../composer/useFirstRuleGuide.js';
import { validateComposer } from '../composer/validation.js';
import { CreateSuccess } from '../components/CreateSuccess.js';
import { AppShell } from '../components/AppShell.js';
import { AccountSetupGate } from '../components/AccountSetupGate.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { useCreateRule } from '../hooks/useCreateRule.js';
import { appRoutes } from '../lib/routes.js';
import { formatRuleSentence } from '../lib/rules.js';
import { Spinner } from '../components/chrome/Spinner.js';
import { unichainPublicClient } from '../lib/wagmi.js';
import '../styles/composer.css';

/** The composer itself, split from the account lookup so tests can render it with an agent. */
export function CreateRuleForm({
  agent,
  initialTemplate = 1,
  initialState,
  edit,
  vaultTerms,
  vaultPending = false,
  refreshVault,
  onReview,
  onCreatedChange,
  onEdited,
}: {
  readonly agent: Address;
  readonly initialTemplate?: TemplateId;
  readonly initialState?: ComposerState;
  readonly edit?: RuleReplacement;
  readonly vaultTerms?: VaultTerms | undefined;
  readonly vaultPending?: boolean;
  readonly refreshVault?: (() => Promise<VaultTerms>) | undefined;
  readonly onReview?: () => void;
  readonly onCreatedChange?: (created: boolean) => void;
  readonly onEdited?: (id: bigint) => void;
}) {
  const [state, dispatch] = useReducer(
    composerReducer,
    initialState ?? initialComposerState(UNICHAIN_SEPOLIA_CHAIN_ID, initialTemplate),
  );
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<SlotKey>>(() => new Set());
  const [makePublic, setMakePublic] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submittedSentence = useRef('');
  const { status, error, result, create, reset } = useCreateRule();
  const created = !!result;
  useEffect(() => onCreatedChange?.(created), [created, onCreatedChange]);

  const { draft, issues } = useMemo(() => validateComposer(state, vaultTerms), [state, vaultTerms]);
  const sentence = draft ? formatRuleSentence(draft) : '';
  const template = getTemplate(state.template);
  const required = template?.slots.filter((slot) => slot.required) ?? [];
  const complete = required.filter((slot) => !issues[slot.key]).length;
  const busy = status === 'simulating' || status === 'signing' || status === 'confirming';
  const needsVault = template?.action !== 'alert';
  const waitingForVault = needsVault && vaultPending;
  const vaultUnavailable = needsVault && !!refreshVault && !vaultTerms;
  const ready = !waitingForVault && !vaultUnavailable ? draft : null;
  const shownIssues = submitted
    ? issues
    : Object.fromEntries(Object.entries(issues).filter(([key]) => touched.has(key as SlotKey)));

  const setSlot = (key: SlotKey, value: string): void => {
    dispatch(value ? { type: 'setSlot', key, value } : { type: 'clearSlot', key });
  };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || waitingForVault || vaultUnavailable) return;
    onReview?.();
    setSubmitted(true);
    if (!ready) {
      const controls = formRef.current?.querySelectorAll<HTMLElement>(
        '[data-slot] input, [data-slot] select',
      );
      const firstInvalid = Array.from(controls ?? []).find((control) => {
        const key = control.closest<HTMLElement>('[data-slot]')?.dataset.slot;
        return key && issues[key];
      });
      firstInvalid?.focus();
      return;
    }
    submittedSentence.current = sentence;
    void create(agent, ready, makePublic, edit).then((updated) => {
      if (edit && updated && updated.ruleId !== null) onEdited?.(updated.ruleId);
    });
  }

  if (result) {
    return (
      <CreateSuccess
        agent={agent}
        ruleId={result.ruleId}
        sentence={submittedSentence.current}
        txHash={result.txHash}
        edited={!!edit}
        {...(edit
          ? {}
          : {
              onCreateAnother: () => {
                dispatch({ type: 'reset' });
                setSubmitted(false);
                setTouched(new Set());
                setMakePublic(false);
                reset();
              },
            })}
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="rule-composer rule-composer__layout">
      <fieldset disabled={busy} className="rule-composer__editor" aria-label="Rule settings">
        <TemplatePicker
          chainId={LASNA_CHAIN_ID}
          selected={state.template}
          onSelect={(template) => {
            dispatch({ type: 'selectTemplate', template });
            setSubmitted(false);
            setTouched(new Set());
          }}
        />
        <RuleFields
          state={state}
          issues={issues}
          shownIssues={shownIssues}
          vault={vaultTerms}
          setSlot={setSlot}
          onTouch={(key) => setTouched((current) => new Set(current).add(key))}
        />
      </fieldset>

      <div className="rule-composer__review">
        <LiveCalldata
          agent={agent}
          draft={ready}
          sentence={sentence}
          makePublic={makePublic}
          edit={edit}
          complete={complete}
          required={required.length}
        />
        <div className="rule-composer__actions">
          <div className="rule-composer__publish">
            <input
              id="publish-rule"
              type="checkbox"
              disabled={busy}
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
          {waitingForVault && (
            <p role="status" className="rule-composer__hint rb-loading">
              <Spinner size={14} />
              Checking vault limits…
            </p>
          )}
          {!waitingForVault && vaultUnavailable && (
            <div role="alert" className="rule-composer__error">
              <p>Vault limits are unavailable. Try again before saving a rule that moves funds.</p>
              <button
                type="button"
                className="rule-composer__secondary"
                onClick={() => void refreshVault?.().catch(() => undefined)}
              >
                Retry vault check
              </button>
            </div>
          )}
          {error ? (
            <div role="alert" className="rule-composer__error">
              <p>{error.message}</p>
              {error.selector ? (
                <p className="font-mono text-[11px] text-ink-muted">selector {error.selector}</p>
              ) : null}
              <p className="text-xs text-ink-muted">
                {error.kind === 'funding'
                  ? 'No transaction was sent.'
                  : error.kind === 'simulation'
                    ? 'Nothing was sent. The simulation is free and runs before you sign.'
                    : error.kind === 'wallet'
                      ? 'The transaction was not created.'
                      : 'Wait for the Lasna receipt before assuming the rule exists.'}
              </p>
              {error.needsDeposit && (
                <Link to={appRoutes.account} target="_blank" rel="noreferrer" className="app-link">
                  Fund your vault (opens in a new tab)
                </Link>
              )}
            </div>
          ) : null}
          <button
            id="review-create-rule"
            type="submit"
            disabled={busy || waitingForVault || vaultUnavailable}
            className="rule-composer__submit"
          >
            {busy && <Spinner />}
            {status === 'simulating'
              ? 'Simulating…'
              : status === 'signing'
                ? 'Waiting for your signature…'
                : status === 'confirming'
                  ? 'Waiting for the Lasna receipt…'
                  : edit
                    ? 'Review and save changes'
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

/** `/create`: connect, find the owner's Agent, then compose. */
export function Create() {
  return (
    <AccountSetupGate title="Compose a rule">
      {({ agent, vault }) => <Composer key={agent} agent={agent} vault={vault} />}
    </AccountSetupGate>
  );
}

function Composer({ agent, vault }: { agent: Address; vault: Address }) {
  const guide = useFirstRuleGuide();
  const [created, setCreated] = useState(false);
  const terms = useComposerVaultTerms(vault);
  return (
    <AppShell>
      <section className="app-page">
        <PageHeading
          title="Compose a rule"
          description="Choose what your rule does and review its terms before you sign."
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
        <CreateRuleForm
          agent={agent}
          vaultTerms={terms.data}
          vaultPending={!terms.data && terms.isFetching}
          refreshVault={async () => {
            const refreshed = await terms.refetch({ throwOnError: true });
            if (!refreshed.data) throw new Error('Vault settings are unavailable.');
            return refreshed.data;
          }}
          onReview={guide.stop}
          onCreatedChange={setCreated}
        />
      </section>
    </AppShell>
  );
}

export function useComposerVaultTerms(vault: Address | undefined) {
  return useQuery({
    queryKey: ['composer-vault-terms', vault],
    enabled: !!vault,
    queryFn: async (): Promise<VaultTerms> => {
      if (!vault) throw new Error('Vault settings are unavailable.');
      const contract = { address: vault, abi: vaultAbi } as const;
      const [tokenIn, tokenOut, ceiling] = await Promise.all([
        unichainPublicClient.readContract({ ...contract, functionName: 'allowedTokenIn' }),
        unichainPublicClient.readContract({ ...contract, functionName: 'allowedTokenOut' }),
        unichainPublicClient.readContract({ ...contract, functionName: 'maxSpendPerRun' }),
      ]);
      return { tokenIn, tokenOut, ceiling };
    },
    retry: false,
    refetchOnWindowFocus: 'always',
  });
}
