import {
  Alert02Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  GitBranchIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useMemo } from 'react';
import { formatUnits, parseUnits } from 'viem';

import {
  actions,
  buildSimulationPresets,
  emptySimulationScenario,
  requiredSimulationInputs,
  workflowV2Action as A,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type SimulationOutcome,
  type V2Draft,
  type WorkflowV2DraftScenario,
  type WorkflowV2SimulationResult,
} from '@rulebook/shared';
import { Badge, Button, FactList, Field, PanelCopy, PanelTitle, type Fact } from '@/ui';
import type { diagramV2 } from './diagramV2';

function formatCompact(value: bigint, decimals: number): string {
  const raw = formatUnits(value, decimals);
  if (!raw.includes('.')) return raw;
  return raw.replace(/\.?0+$/, '');
}

function formatUsdc(value: bigint): string {
  return `${formatCompact(value, 6)} USDC`;
}

function formatWeth(value: bigint): string {
  return `${formatCompact(value, 18)} WETH`;
}

function formatUsd(value: bigint): string {
  const raw = formatCompact(value, 18);
  const [whole, fraction] = raw.split('.');
  const formattedWhole = Number(whole).toLocaleString('en-US');
  return fraction ? `$${formattedWhole}.${fraction}` : `$${formattedWhole}`;
}

function tryParseDecimal(value: string, decimals: number): bigint | undefined {
  const text = value.trim();
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return undefined;
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length > decimals) return undefined;
  return parseUnits(text, decimals);
}

function formatDuration(secondsText: string): string | undefined {
  const seconds = tryParseDecimal(secondsText, 0);
  if (seconds === undefined) return undefined;
  const total = Number(seconds);
  if (!Number.isFinite(total)) return undefined;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${total}s`);
  return parts.join(' ');
}

function pathDisplayLabel(anchor: string): string {
  const branches = anchor
    .split('-')
    .filter((part) => part === 'yes' || part === 'otherwise')
    .map((part) => (part === 'yes' ? 'Yes' : 'Otherwise'));
  return branches.length ? `${branches.join(' / ')} path` : 'Main path';
}

function outcomeIcon(outcome: SimulationOutcome) {
  switch (outcome) {
    case 'would_execute':
      return CheckmarkCircle02Icon;
    case 'in_grace_period':
      return Clock01Icon;
    case 'skipped':
      return Alert02Icon;
    case 'blocked_cap':
    case 'expired':
      return Cancel01Icon;
    case 'incomplete':
      return Alert02Icon;
  }
}

export function createInitialSimulationScenario(
  draft: V2Draft,
  initialWeeklySpent?: { readonly usdc: bigint; readonly weth: bigint },
): WorkflowV2DraftScenario {
  const base = emptySimulationScenario();
  const presets = buildSimulationPresets(draft);
  const first = presets[0]?.scenario ?? {};
  const reqs = requiredSimulationInputs(draft);
  return {
    ...base,
    referencePrice: reqs.defaultReferencePrice ?? '',
    ...first,
    usdcWeeklySpent:
      initialWeeklySpent && initialWeeklySpent.usdc > 0n
        ? formatCompact(initialWeeklySpent.usdc, 6)
        : '',
    wethWeeklySpent:
      initialWeeklySpent && initialWeeklySpent.weth > 0n
        ? formatCompact(initialWeeklySpent.weth, 18)
        : '',
  };
}

function scenarioMatchesPreset(
  scenario: WorkflowV2DraftScenario,
  presetScenario: Partial<WorkflowV2DraftScenario>,
): boolean {
  if (scenario.simulateExpired) return false;
  const keys = Object.keys(presetScenario) as (keyof WorkflowV2DraftScenario)[];
  return keys.every((key) => scenario[key] === presetScenario[key]);
}

export function WorkflowSimulator({
  draft,
  diagram,
  scenario,
  onScenarioChange,
  result,
  initialWeeklySpent,
  onSelectNode,
}: {
  readonly draft: V2Draft;
  readonly diagram: ReturnType<typeof diagramV2>;
  readonly scenario: WorkflowV2DraftScenario;
  readonly onScenarioChange: (next: WorkflowV2DraftScenario) => void;
  readonly result: WorkflowV2SimulationResult;
  readonly initialWeeklySpent?: { readonly usdc: bigint; readonly weth: bigint };
  readonly onSelectNode?: (nodeIndex: number) => void;
}) {
  const requirements = useMemo(() => requiredSimulationInputs(draft), [draft]);
  const presets = useMemo(() => buildSimulationPresets(draft), [draft]);
  const initialScenario = useMemo(
    () => createInitialSimulationScenario(draft, initialWeeklySpent),
    [draft, initialWeeklySpent],
  );
  const hasSampleInputs =
    requirements.needsObservedAmount ||
    requirements.needsActor ||
    requirements.needsPrice ||
    requirements.needsPreviousPrice ||
    requirements.needsTrailingHigh ||
    requirements.needsReferencePrice ||
    requirements.needsVaultUsdc ||
    requirements.needsInactivity ||
    requirements.hasInactivityPayout;
  const hasWeeklyBudget = requirements.hasUsdcWeeklyBudget || requirements.hasWethWeeklyBudget;
  const hasRunState = hasWeeklyBudget || requirements.hasExpiry;

  const trailingReadout = useMemo(() => {
    if (!requirements.needsTrailingHigh) return undefined;
    const price = tryParseDecimal(scenario.price, 18);
    const high = tryParseDecimal(scenario.trailingHigh, 18);
    if (price === undefined || price === 0n) return undefined;
    if (high === undefined || high === 0n) {
      return `First run sets trailing high to ${formatUsd(price)}`;
    }
    if (price > high) {
      return `New peak — raises trailing high to ${formatUsd(price)}`;
    }
    const dropBps = ((high - price) * 10_000n) / high;
    return `-${formatCompact(dropBps, 2)}% from ${formatUsd(high)} high`;
  }, [requirements.needsTrailingHigh, scenario.price, scenario.trailingHigh]);

  const inactivityReadout = useMemo(
    () => (requirements.needsInactivity ? formatDuration(scenario.inactiveSeconds) : undefined),
    [requirements.needsInactivity, scenario.inactiveSeconds],
  );

  const matchedLeafAnchor =
    result.leafIndex !== null ? diagram.paths[result.leafIndex]?.anchor : undefined;

  const guardrailFacts = useMemo(() => {
    if (result.outcome === 'incomplete') return [];
    const facts: Fact[] = [];
    if (requirements.hasUsdcSpend || result.usdcCap > 0n) {
      facts.push({
        term: 'USDC per run',
        value: `${formatUsdc(result.totalUsdcSpent)} of ${formatUsdc(result.usdcCap)}`,
        valueClassName: 'workflow-sim-mono',
      });
    }
    if (requirements.hasWethSpend || result.wethCap > 0n) {
      facts.push({
        term: 'WETH per run',
        value: `${formatWeth(result.totalWethSpent)} of ${formatWeth(result.wethCap)}`,
        valueClassName: 'workflow-sim-mono',
      });
    }
    if (result.weeklyBudget && result.weeklyBudget.usdcLimit > 0n) {
      facts.push({
        term: 'Weekly USDC',
        value: `${formatUsdc(result.weeklyBudget.usdcSpentAfter)} of ${formatUsdc(result.weeklyBudget.usdcLimit)}`,
        valueClassName: 'workflow-sim-mono',
      });
    }
    if (result.weeklyBudget && result.weeklyBudget.wethLimit > 0n) {
      facts.push({
        term: 'Weekly WETH',
        value: `${formatWeth(result.weeklyBudget.wethSpentAfter)} of ${formatWeth(result.weeklyBudget.wethLimit)}`,
        valueClassName: 'workflow-sim-mono',
      });
    }
    return facts;
  }, [
    requirements.hasUsdcSpend,
    requirements.hasWethSpend,
    result.outcome,
    result.totalUsdcSpent,
    result.totalWethSpent,
    result.usdcCap,
    result.weeklyBudget,
    result.wethCap,
  ]);

  const setField = <K extends keyof WorkflowV2DraftScenario>(
    key: K,
    value: WorkflowV2DraftScenario[K],
  ) => {
    onScenarioChange({ ...scenario, [key]: value });
  };

  return (
    <div className="workflow-sim">
      <header className="workflow-sim-head">
        <PanelTitle>Test this workflow</PanelTitle>
        <PanelCopy>
          {hasSampleInputs || hasRunState
            ? 'Local preview. The result updates as you edit.'
            : draft.trigger === T.schedule
              ? 'Local preview of one scheduled run.'
              : 'Local preview of one trigger event.'}
        </PanelCopy>
      </header>

      <div className="workflow-sim-verdict" data-outcome={result.outcome} role="status">
        <div className="workflow-sim-verdict-head">
          <HugeiconsIcon icon={outcomeIcon(result.outcome)} size={17} aria-hidden="true" />
          <h3 className="workflow-sim-headline">{result.headline}</h3>
        </div>
        {result.outcome !== 'would_execute' && (
          <p className="workflow-sim-detail">{result.detail}</p>
        )}
        {result.trace.length > 0 && matchedLeafAnchor && (
          <p className="workflow-sim-detail">{pathDisplayLabel(matchedLeafAnchor)}</p>
        )}
        {result.wouldClose && result.outcome === 'would_execute' && (
          <p className="workflow-sim-detail">The workflow would close after this run settles.</p>
        )}
      </div>

      {(hasSampleInputs || hasRunState) && (
        <section className="workflow-sim-section" aria-label="Scenario">
          <div className="workflow-sim-section-head workflow-sim-scenario-heading">
            <h3>Scenario</h3>
            <Button
              variant="quiet"
              className="workflow-sim-reset"
              aria-label="Reset scenario"
              disabled={scenarioMatchesPreset(scenario, initialScenario)}
              onClick={() => onScenarioChange(initialScenario)}
            >
              <HugeiconsIcon icon={RefreshIcon} size={13} aria-hidden="true" />
              Reset
            </Button>
          </div>
          {presets.length > 1 && (
            <div role="group" aria-label="Example scenarios">
              <p className="workflow-sim-note">Try an example</p>
              <div className="workflow-sim-presets">
                {presets.map((preset) => (
                  <Button
                    key={preset.id}
                    className="workflow-sim-preset"
                    aria-pressed={scenarioMatchesPreset(scenario, preset.scenario)}
                    onClick={() =>
                      onScenarioChange({ ...scenario, simulateExpired: false, ...preset.scenario })
                    }
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {hasSampleInputs && (
            <div className="workflow-sim-fields">
              {requirements.needsObservedAmount && (
                <Field
                  label={
                    requirements.observedAmountUnit === 'USDC'
                      ? 'Incoming payment (USDC)'
                      : 'Transfer amount (raw token units)'
                  }
                  hint={
                    requirements.observedAmountUnit === 'USDC'
                      ? 'Simulated USDC received by your Vault.'
                      : 'Token base units observed on the watched transfer.'
                  }
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      value={scenario.observedAmount}
                      inputMode="decimal"
                      placeholder={requirements.observedAmountUnit === 'USDC' ? '0.60' : '1000000'}
                      aria-describedby={ids.hint}
                      onChange={(event) => setField('observedAmount', event.target.value)}
                    />
                  )}
                </Field>
              )}

              {requirements.needsActor && (
                <Field
                  label="Sender wallet address"
                  hint="Address that sent the incoming USDC payment."
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      value={scenario.actor}
                      inputMode="text"
                      placeholder="0x…"
                      aria-describedby={ids.hint}
                      onChange={(event) => setField('actor', event.target.value)}
                    />
                  )}
                </Field>
              )}

              {requirements.needsTrailingHigh && (
                <Field
                  label="Trailing high price (USDC per WETH)"
                  hint="Highest price recorded before this check. Leave blank for first run."
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      value={scenario.trailingHigh}
                      inputMode="decimal"
                      placeholder="3000"
                      aria-describedby={ids.hint}
                      onChange={(event) => setField('trailingHigh', event.target.value)}
                    />
                  )}
                </Field>
              )}

              {requirements.needsPreviousPrice && (
                <Field
                  label="Previous pool price (USDC per WETH)"
                  hint="Last observed price before this move."
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      value={scenario.previousPrice}
                      inputMode="decimal"
                      placeholder="1950"
                      aria-describedby={ids.hint}
                      onChange={(event) => setField('previousPrice', event.target.value)}
                    />
                  )}
                </Field>
              )}

              {requirements.needsReferencePrice && (
                <Field
                  label="Baseline / reference price (USDC per WETH)"
                  hint="Leave blank to simulate the first run before a baseline is stored."
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      value={scenario.referencePrice}
                      inputMode="decimal"
                      placeholder={requirements.defaultReferencePrice ?? '2500'}
                      aria-describedby={ids.hint}
                      onChange={(event) => setField('referencePrice', event.target.value)}
                    />
                  )}
                </Field>
              )}

              {requirements.needsPrice && (
                <Field
                  label="Pool price (USDC per WETH)"
                  hint={trailingReadout ?? 'Current WETH price in USDC.'}
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      value={scenario.price}
                      inputMode="decimal"
                      placeholder="2850"
                      aria-describedby={ids.hint}
                      onChange={(event) => setField('price', event.target.value)}
                    />
                  )}
                </Field>
              )}

              {requirements.needsVaultUsdc && (
                <Field
                  label="Vault USDC balance"
                  hint="Current USDC held in your Vault before refill."
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      value={scenario.vaultUsdcBalance}
                      inputMode="decimal"
                      placeholder="2"
                      aria-describedby={ids.hint}
                      onChange={(event) => setField('vaultUsdcBalance', event.target.value)}
                    />
                  )}
                </Field>
              )}

              {requirements.needsInactivity && (
                <Field
                  label="Time without activity (seconds)"
                  hint={
                    inactivityReadout
                      ? `Simulated duration: ${inactivityReadout}`
                      : 'Seconds since last owner check-in or wallet activity.'
                  }
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      value={scenario.inactiveSeconds}
                      inputMode="numeric"
                      placeholder="604800"
                      aria-describedby={ids.hint}
                      onChange={(event) => setField('inactiveSeconds', event.target.value)}
                    />
                  )}
                </Field>
              )}

              {requirements.hasInactivityPayout && (
                <label className="workflow-sim-checkbox">
                  <input
                    type="checkbox"
                    checked={scenario.inactivityGraceElapsed}
                    onChange={(event) => setField('inactivityGraceElapsed', event.target.checked)}
                  />
                  All payout waiting periods have elapsed
                </label>
              )}
            </div>
          )}

          {hasRunState && (
            <details className="workflow-sim-details">
              <summary>
                {hasWeeklyBudget
                  ? requirements.hasExpiry
                    ? 'Weekly spending and expiry'
                    : 'Weekly spending'
                  : 'Expiry'}
              </summary>
              <div className="workflow-sim-fields">
                {requirements.hasUsdcWeeklyBudget && (
                  <Field
                    label="Already spent this week (USDC)"
                    hint={`Weekly limit: ${draft.usdcWeeklyBudget} USDC`}
                  >
                    {(ids) => (
                      <input
                        className="app-input"
                        value={scenario.usdcWeeklySpent}
                        inputMode="decimal"
                        placeholder="0"
                        aria-describedby={ids.hint}
                        onChange={(event) => setField('usdcWeeklySpent', event.target.value)}
                      />
                    )}
                  </Field>
                )}

                {requirements.hasWethWeeklyBudget && (
                  <Field
                    label="Already spent this week (WETH)"
                    hint={`Weekly limit: ${draft.wethWeeklyBudget} WETH`}
                  >
                    {(ids) => (
                      <input
                        className="app-input"
                        value={scenario.wethWeeklySpent}
                        inputMode="decimal"
                        placeholder="0"
                        aria-describedby={ids.hint}
                        onChange={(event) => setField('wethWeeklySpent', event.target.value)}
                      />
                    )}
                  </Field>
                )}

                {requirements.hasExpiry && (
                  <label className="workflow-sim-checkbox">
                    <input
                      type="checkbox"
                      checked={scenario.simulateExpired}
                      onChange={(event) => setField('simulateExpired', event.target.checked)}
                    />
                    Simulate past workflow expiry
                  </label>
                )}
              </div>
            </details>
          )}
        </section>
      )}

      {result.actions.length > 0 && (
        <section className="workflow-sim-section" aria-label="Simulated actions">
          <div className="workflow-sim-section-head">
            <h3>{result.outcome === 'in_grace_period' ? 'Payout after waiting' : 'Actions'}</h3>
          </div>
          <ol className="workflow-sim-actions">
            {result.actions.map((step) => {
              const amountText =
                step.kind === A.alert
                  ? 'Records an on-chain alert'
                  : step.asset === 'USDC'
                    ? formatUsdc(step.resolvedAmount)
                    : step.asset === 'WETH'
                      ? formatWeth(step.resolvedAmount)
                      : '';
              const percentHint =
                step.unit === U.percent
                  ? ` (${formatCompact(step.configuredAmount, 2)}% of payment)`
                  : '';
              return (
                <li key={step.stepIndex} className="workflow-sim-action-item">
                  <span className="workflow-sim-action-title">
                    <HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" />
                    <strong>{actions[step.kind].name}</strong>
                  </span>
                  <span className="workflow-sim-action-meta workflow-sim-mono">
                    {amountText}
                    {percentHint}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {result.trace.length > 0 && (
        <details className="workflow-sim-section workflow-sim-details">
          <summary>Decision path</summary>
          <ol className="workflow-sim-trace">
            {result.trace.map((step) => (
              <li key={step.nodeIndex}>
                <Button
                  variant="quiet"
                  className="workflow-sim-trace-button"
                  onClick={() => onSelectNode?.(step.nodeIndex)}
                >
                  <span className="workflow-sim-trace-top">
                    <span className="workflow-sim-trace-name">
                      <HugeiconsIcon icon={GitBranchIcon} size={13} aria-hidden="true" />
                      {step.checkName}
                    </span>
                    <Badge tone={step.matched ? 'info' : 'paused'} plain>
                      {step.matched ? 'Yes' : 'Otherwise'}
                    </Badge>
                  </span>
                  <span className="workflow-sim-trace-summary workflow-sim-mono">
                    {step.summary}
                  </span>
                  {step.note && <span className="workflow-sim-trace-note">{step.note}</span>}
                </Button>
              </li>
            ))}
          </ol>
        </details>
      )}

      {guardrailFacts.length > 0 && (
        <details className="workflow-sim-section workflow-sim-details">
          <summary>Spending limits</summary>
          <FactList items={guardrailFacts} />
        </details>
      )}
    </div>
  );
}
