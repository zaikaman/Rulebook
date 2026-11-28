import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  buildSimulationPresets,
  createWorkflowV2Recipe,
  emptyDraft,
  emptySimulationScenario,
  requiredSimulationInputs,
  simulateWorkflowV2Draft,
  simulateWorkflowV2Program,
  toDraft,
  workflowV2Action as A,
  workflowV2Check as C,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type V2Draft,
  type WorkflowV2Program,
} from '../src/index.js';

const recipient = '0x0000000000000000000000000000000000000002';
const sender = '0x0000000000000000000000000000000000000003';
const otherWallet = '0x0000000000000000000000000000000000000004';

const recipeValues = {
  intervalSeconds: '3600',
  expiresAt: '2000000000',
  buyUsdc: '1.5',
  sellWeth: '0.05',
  slippagePercent: '1',
  dipPercent: '5',
  limitPrice: '1500',
  targetPrice: '2500',
  stopPrice: '1250',
  trailPercent: '8',
  bandPercent: '5',
  referencePrice: '2000',
  recipient,
  sendUsdc: '0.2',
  minimumPaymentUsdc: '1',
  smallPaymentUsdc: '0.25',
  smallSweepUsdc: '0.05',
  floorUsdc: '4',
  refillUsdc: '2',
  inactivitySeconds: '604800',
  direction: 'rising',
  lowerPrice: '1000',
  upperPrice: '3000',
  token: otherWallet,
  watchedWallet: sender,
  minimumTransferRaw: '1000000',
};

function makeProgram(overrides: Partial<WorkflowV2Program>): WorkflowV2Program {
  return {
    chain: 1301,
    originChain: 1301,
    trigger: T.price,
    interval: 0,
    expires: 0n,
    source: '0x0000000000000000000000000000000000000000',
    subject: '0x0000000000000000000000000000000000000000',
    usdcCap: parseUnits('100', 6),
    wethCap: parseUnits('10', 18),
    slippage: 100,
    once: false,
    nodes: [{ check: 0, yes: 0, no: 0, value: 0n, upper: 0n, actions: [] }],
    ...overrides,
  };
}

describe('simulateWorkflowV2Program', () => {
  it('walks a multi-branch income sweep tree and aligns leafIndex with pre-order DFS', () => {
    const program = createWorkflowV2Recipe('income-sweep', recipeValues);

    // 0: amountAtLeast 1 USDC -> yes: 1 (send 0.2), no: 2 (amountAtLeast 0.25 -> yes: 3 (send 0.05), no: 4 (skip))
    const large = simulateWorkflowV2Program(program, {
      observedAmount: parseUnits('1', 6),
    });
    expect(large.outcome).toBe('would_execute');
    expect(large.leafIndex).toBe(1);
    expect(large.actions).toHaveLength(1);
    expect(large.actions[0]?.resolvedAmount).toBe(parseUnits('0.2', 6));

    const middle = simulateWorkflowV2Program(program, {
      observedAmount: parseUnits('0.60', 6),
    });
    expect(middle.outcome).toBe('would_execute');
    expect(middle.leafIndex).toBe(3);
    expect(middle.trace.map((step) => step.matched)).toEqual([false, true]);
    expect(middle.actions[0]?.resolvedAmount).toBe(parseUnits('0.05', 6));

    const small = simulateWorkflowV2Program(program, {
      observedAmount: parseUnits('0.10', 6),
    });
    expect(small.outcome).toBe('skipped');
    expect(small.reason).toBe('empty_path');
    expect(small.leafIndex).toBe(4);
    expect(small.actions).toHaveLength(0);
  });

  it('walks a 3-deep custom condition tree to the exact leaf', () => {
    const program = makeProgram({
      trigger: T.payment,
      subject: sender,
      nodes: [
        { check: C.paymentFrom, yes: 1, no: 6, value: 0n, upper: 0n, actions: [] },
        {
          check: C.amountAtLeast,
          yes: 2,
          no: 5,
          value: parseUnits('10', 6),
          upper: 0n,
          actions: [],
        },
        { check: C.amountAbove, yes: 3, no: 4, value: parseUnits('50', 6), upper: 0n, actions: [] },
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [{ kind: A.send, unit: U.percent, amount: 2500n, account: recipient }],
        },
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [
            { kind: A.send, unit: U.fixed, amount: parseUnits('2', 6), account: recipient },
          ],
        },
        { check: 0, yes: 0, no: 0, value: 0n, upper: 0n, actions: [] },
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [
            {
              kind: A.alert,
              unit: U.fixed,
              amount: 0n,
              account: '0x0000000000000000000000000000000000000000',
            },
          ],
        },
      ],
    });

    const deepHit = simulateWorkflowV2Program(program, {
      actor: sender,
      observedAmount: parseUnits('60', 6),
    });
    expect(deepHit.outcome).toBe('would_execute');
    expect(deepHit.leafIndex).toBe(3);
    expect(deepHit.actions[0]?.resolvedAmount).toBe(parseUnits('15', 6));

    const boundaryFifty = simulateWorkflowV2Program(program, {
      actor: sender,
      observedAmount: parseUnits('50', 6),
    });
    expect(boundaryFifty.leafIndex).toBe(4);
    expect(boundaryFifty.actions[0]?.resolvedAmount).toBe(parseUnits('2', 6));

    const wrongSender = simulateWorkflowV2Program(program, {
      actor: otherWallet,
      observedAmount: parseUnits('60', 6),
    });
    expect(wrongSender.leafIndex).toBe(6);
    expect(wrongSender.actions[0]?.kind).toBe(A.alert);
  });

  it('evaluates trailing stop, hard stop, and peak updating identically to Vault', () => {
    const program = createWorkflowV2Recipe('trailing-stop', recipeValues);

    // 8% trailing drop from 3000 => target 2760. At 2850, holds (skips).
    const hold = simulateWorkflowV2Program(program, {
      trailingHigh: parseUnits('3000', 18),
      price: parseUnits('2850', 18),
    });
    expect(hold.outcome).toBe('skipped');
    expect(hold.leafIndex).toBe(4);

    // At 2760 exact boundary, triggers trailing sell.
    const trailHit = simulateWorkflowV2Program(program, {
      trailingHigh: parseUnits('3000', 18),
      price: parseUnits('2760', 18),
    });
    expect(trailHit.outcome).toBe('would_execute');
    expect(trailHit.leafIndex).toBe(3);
    expect(trailHit.wouldClose).toBe(true);
    expect(trailHit.totalWethSpent).toBe(parseUnits('0.05', 18));

    // At 1200 (below 1250 hard stop), hits first branch (leaf 1).
    const hardStop = simulateWorkflowV2Program(program, {
      trailingHigh: parseUnits('3000', 18),
      price: parseUnits('1200', 18),
    });
    expect(hardStop.outcome).toBe('would_execute');
    expect(hardStop.leafIndex).toBe(1);

    // Price above trailingHigh updates peak and does not trigger trail.
    const newHigh = simulateWorkflowV2Program(program, {
      trailingHigh: parseUnits('3000', 18),
      price: parseUnits('3200', 18),
    });
    expect(newHigh.outcome).toBe('skipped');
    expect(newHigh.trace[1]?.note).toContain('$3,200');
  });

  it('evaluates all remaining check types with exact boundary math', () => {
    // Price band: aboveReference (leaf 1) and belowReference (leaf 2)
    const band = createWorkflowV2Recipe('price-band', recipeValues);
    expect(
      simulateWorkflowV2Program(band, {
        price: parseUnits('2100', 18),
        referencePrice: parseUnits('2000', 18),
      }).leafIndex,
    ).toBe(1);
    expect(
      simulateWorkflowV2Program(band, {
        price: parseUnits('1900', 18),
        referencePrice: parseUnits('2000', 18),
      }).leafIndex,
    ).toBe(3);
    expect(
      simulateWorkflowV2Program(band, {
        price: parseUnits('2000', 18),
        referencePrice: parseUnits('2000', 18),
      }).leafIndex,
    ).toBe(4);

    // Dip by: seeds baseline when referencePrice is 0, triggers when price <= baseline * (1 - dip%)
    const dip = createWorkflowV2Recipe('buy-the-dip', recipeValues);
    const firstDipRun = simulateWorkflowV2Program(dip, { price: parseUnits('2000', 18) });
    expect(firstDipRun.outcome).toBe('skipped');
    expect(firstDipRun.trace[0]?.note).toContain('baseline');
    const dipped = simulateWorkflowV2Program(dip, {
      referencePrice: parseUnits('2000', 18),
      price: parseUnits('1900', 18),
    });
    expect(dipped.outcome).toBe('would_execute');

    // Price outside range
    const rangeAlert = createWorkflowV2Recipe('price-range-alert', recipeValues);
    expect(simulateWorkflowV2Program(rangeAlert, { price: parseUnits('999', 18) }).outcome).toBe(
      'would_execute',
    );
    expect(simulateWorkflowV2Program(rangeAlert, { price: parseUnits('1000', 18) }).outcome).toBe(
      'skipped',
    );
    expect(simulateWorkflowV2Program(rangeAlert, { price: parseUnits('3001', 18) }).outcome).toBe(
      'would_execute',
    );

    // Price below & rises/falls through
    const crossProgram = makeProgram({
      nodes: [
        {
          check: C.priceRisesThrough,
          yes: 1,
          no: 2,
          value: parseUnits('2000', 18),
          upper: 0n,
          actions: [],
        },
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [
            {
              kind: A.alert,
              unit: U.fixed,
              amount: 0n,
              account: '0x0000000000000000000000000000000000000000',
            },
          ],
        },
        {
          check: C.priceFallsThrough,
          yes: 3,
          no: 4,
          value: parseUnits('1500', 18),
          upper: 0n,
          actions: [],
        },
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [
            {
              kind: A.alert,
              unit: U.fixed,
              amount: 0n,
              account: '0x0000000000000000000000000000000000000000',
            },
          ],
        },
        { check: 0, yes: 0, no: 0, value: 0n, upper: 0n, actions: [] },
      ],
    });
    expect(
      simulateWorkflowV2Program(crossProgram, {
        previousPrice: parseUnits('1999', 18),
        price: parseUnits('2000', 18),
      }).leafIndex,
    ).toBe(1);
    expect(
      simulateWorkflowV2Program(crossProgram, {
        previousPrice: parseUnits('1500', 18),
        price: parseUnits('1499', 18),
      }).leafIndex,
    ).toBe(3);

    const priceBelowProgram = makeProgram({
      nodes: [
        {
          check: C.priceBelow,
          yes: 1,
          no: 2,
          value: parseUnits('2000', 18),
          upper: 0n,
          actions: [],
        },
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [
            {
              kind: A.alert,
              unit: U.fixed,
              amount: 0n,
              account: '0x0000000000000000000000000000000000000000',
            },
          ],
        },
        { check: 0, yes: 0, no: 0, value: 0n, upper: 0n, actions: [] },
      ],
    });
    expect(
      simulateWorkflowV2Program(priceBelowProgram, { price: parseUnits('2000', 18) }).outcome,
    ).toBe('skipped');
    expect(
      simulateWorkflowV2Program(priceBelowProgram, { price: parseUnits('1999', 18) }).outcome,
    ).toBe('would_execute');
  });

  it('caps refill amounts to the shortfall and models inactivity grace period', () => {
    const refill = createWorkflowV2Recipe('balance-refill', recipeValues);
    const partial = simulateWorkflowV2Program(refill, {
      vaultUsdcBalance: parseUnits('3.25', 6),
    });
    expect(partial.outcome).toBe('would_execute');
    const budgetLimited = simulateWorkflowV2Program(refill, {
      vaultUsdcBalance: parseUnits('3.25', 6),
      weeklyBudget: {
        usdcLimit: parseUnits('10', 6),
        wethLimit: 0n,
        usdcSpent: parseUnits('9.50', 6),
      },
    });
    expect(budgetLimited.outcome).toBe('would_execute');
    expect(budgetLimited.actions[0]?.resolvedAmount).toBe(parseUnits('0.5', 6));
    expect(partial.actions[0]?.resolvedAmount).toBe(parseUnits('0.75', 6));
    expect(partial.totalUsdcSpent).toBe(parseUnits('0.75', 6));

    const payout = createWorkflowV2Recipe('inactivity-payout', recipeValues, {
      inactivityPayout: true,
    });
    const grace = simulateWorkflowV2Program(payout, {
      inactiveSeconds: 604_800n,
      inactivityGraceElapsed: false,
    });
    expect(grace.outcome).toBe('in_grace_period');
    expect(grace.actions).toHaveLength(1);

    const ready = simulateWorkflowV2Program(payout, {
      inactiveSeconds: 604_800n,
      inactivityGraceElapsed: true,
    });
    expect(ready.outcome).toBe('would_execute');
    expect(ready.wouldClose).toBe(true);
  });

  it('enforces per-run caps, payment cap, weekly budgets, percent rounding, and expiry', () => {
    const baseProgram = createWorkflowV2Recipe('scheduled-buy', recipeValues);
    const lowCap = { ...baseProgram, usdcCap: parseUnits('1', 6) };
    const capBlocked = simulateWorkflowV2Program(lowCap);
    expect(capBlocked.outcome).toBe('blocked_cap');
    expect(capBlocked.reason).toBe('usdc_cap_exceeded');

    const weeklyBlocked = simulateWorkflowV2Program(baseProgram, {
      weeklyBudget: {
        usdcLimit: parseUnits('2', 6),
        wethLimit: 0n,
        usdcSpent: parseUnits('1', 6),
      },
    });
    expect(weeklyBlocked.outcome).toBe('skipped');
    expect(weeklyBlocked.reason).toBe('weekly_usdc_budget_exceeded');

    const wethProgram = createWorkflowV2Recipe('take-profit', recipeValues);
    expect(
      simulateWorkflowV2Program(
        { ...wethProgram, wethCap: parseUnits('0.01', 18) },
        { price: parseUnits('2600', 18) },
      ).reason,
    ).toBe('weth_cap_exceeded');
    expect(
      simulateWorkflowV2Program(wethProgram, {
        price: parseUnits('2600', 18),
        weeklyBudget: {
          usdcLimit: 0n,
          wethLimit: parseUnits('0.06', 18),
          wethSpent: parseUnits('0.02', 18),
        },
      }).reason,
    ).toBe('weekly_weth_budget_exceeded');

    const expired = simulateWorkflowV2Program(
      { ...baseProgram, expires: 1000n },
      { nowSeconds: 1001n },
    );
    expect(expired.outcome).toBe('expired');
    expect(expired.leafIndex).toBeNull();

    const percentProgram = makeProgram({
      trigger: T.payment,
      usdcCap: parseUnits('10', 6),
      nodes: [
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [{ kind: A.send, unit: U.percent, amount: 100n, account: recipient }],
        },
      ],
    });
    // 1% of 10 raw USDC units (0.000010 USDC) = 0 -> skips
    const zeroRound = simulateWorkflowV2Program(percentProgram, { observedAmount: 10n });
    expect(zeroRound.outcome).toBe('skipped');
    expect(zeroRound.reason).toBe('zero_amount');

    // Payment cap: fixed spend exceeds incoming payment
    const fixedPayment = makeProgram({
      trigger: T.payment,
      usdcCap: parseUnits('100', 6),
      nodes: [
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [
            { kind: A.send, unit: U.fixed, amount: parseUnits('5', 6), account: recipient },
          ],
        },
      ],
    });
    const overPayment = simulateWorkflowV2Program(fixedPayment, {
      observedAmount: parseUnits('4', 6),
    });
    expect(overPayment.outcome).toBe('blocked_cap');
    expect(overPayment.reason).toBe('payment_cap_exceeded');
    expect(overPayment.actions).toEqual([]);
  });

  it('tracks Vault balance across multi-step paths, rolls back atomically, and checks refill funding', () => {
    const twoStepSpend = makeProgram({
      trigger: T.schedule,
      usdcCap: parseUnits('10', 6),
      nodes: [
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [
            { kind: A.send, unit: U.fixed, amount: parseUnits('3', 6), account: recipient },
            {
              kind: A.buy,
              unit: U.fixed,
              amount: parseUnits('3', 6),
              account: '0x0000000000000000000000000000000000000000',
            },
          ],
        },
      ],
    });
    const exhausted = simulateWorkflowV2Program(twoStepSpend, {
      vaultUsdcBalance: parseUnits('4', 6),
    });
    expect(exhausted.outcome).toBe('skipped');
    expect(exhausted.reason).toBe('insufficient_vault_balance');
    expect(exhausted.actions).toEqual([]);

    const refillThenSpend = makeProgram({
      trigger: T.schedule,
      usdcCap: parseUnits('10', 6),
      nodes: [
        { check: C.usdcBelow, yes: 1, no: 2, value: parseUnits('5', 6), upper: 0n, actions: [] },
        {
          check: 0,
          yes: 0,
          no: 0,
          value: 0n,
          upper: 0n,
          actions: [
            {
              kind: A.refill,
              unit: U.fixed,
              amount: parseUnits('4', 6),
              account: '0x0000000000000000000000000000000000000000',
            },
            { kind: A.send, unit: U.fixed, amount: parseUnits('4', 6), account: recipient },
          ],
        },
        { check: 0, yes: 0, no: 0, value: 0n, upper: 0n, actions: [] },
      ],
    });
    expect(
      simulateWorkflowV2Program(refillThenSpend, {
        vaultUsdcBalance: parseUnits('1', 6),
      }).outcome,
    ).toBe('would_execute');
    expect(
      simulateWorkflowV2Program(refillThenSpend, {
        vaultUsdcBalance: parseUnits('1', 6),
        ownerUsdcAllowance: 0n,
      }).reason,
    ).toBe('insufficient_refill_allowance');
    expect(
      simulateWorkflowV2Program(refillThenSpend, {
        vaultUsdcBalance: parseUnits('1', 6),
        ownerUsdcAllowance: parseUnits('10', 6),
        ownerUsdcBalance: 0n,
      }).reason,
    ).toBe('insufficient_owner_balance');

    const cycle = makeProgram({
      nodes: [
        {
          check: C.priceAtLeast,
          yes: 0,
          no: 0,
          value: parseUnits('1000', 18),
          upper: 0n,
          actions: [],
        },
      ],
    });
    expect(simulateWorkflowV2Program(cycle, { price: parseUnits('1500', 18) }).reason).toBe(
      'invalid_draft',
    );
  });
});

describe('simulateWorkflowV2Draft & buildSimulationPresets', () => {
  it('simulates an incomplete draft without requiring title, slippage, or recipient', () => {
    const draft: V2Draft = {
      ...emptyDraft(),
      trigger: T.payment,
      usdcCap: '1',
      root: {
        check: C.amountAtLeast,
        value: '0.5',
        upper: '',
        yes: {
          steps: [{ kind: A.send, unit: U.fixed, amount: '0.25', recipient: '' }],
        },
        no: { steps: [] },
      },
    };

    const result = simulateWorkflowV2Draft(draft, {
      ...emptySimulationScenario(),
      observedAmount: '0.60',
    });
    expect(result.outcome).toBe('would_execute');
    expect(result.leafIndex).toBe(1);
    expect(result.totalUsdcSpent).toBe(parseUnits('0.25', 6));

    const missing = simulateWorkflowV2Draft(draft, emptySimulationScenario());
    expect(missing.outcome).toBe('incomplete');
    expect(missing.missingFields).toContain('Incoming payment (USDC)');
  });

  it('needs the incoming payment to check the cap on a fixed send', () => {
    const draft: V2Draft = {
      ...emptyDraft(),
      trigger: T.payment,
      usdcCap: '1',
      root: {
        steps: [{ kind: A.send, unit: U.fixed, amount: '0.25', recipient }],
      },
    };
    const scenario = emptySimulationScenario();
    const missing = simulateWorkflowV2Draft(draft, scenario);
    expect(missing.outcome).toBe('incomplete');
    expect(missing.missingFields).toEqual(['Incoming payment (USDC)']);
    expect(simulateWorkflowV2Draft(draft, { ...scenario, observedAmount: '0.20' }).reason).toBe(
      'payment_cap_exceeded',
    );
    expect(
      simulateWorkflowV2Draft(
        { ...draft, trigger: T.schedule },
        { ...scenario, observedAmount: '0.20', actor: 'unfinished' },
      ).outcome,
    ).toBe('would_execute');
  });

  it('builds concrete presets and field requirements across recipes', () => {
    const sweepDraft = toDraft(
      createWorkflowV2Recipe('income-sweep', recipeValues),
      'Income sweep',
    );
    const sweepReqs = requiredSimulationInputs(sweepDraft);
    expect(sweepReqs.needsObservedAmount).toBe(true);
    expect(sweepReqs.observedAmountUnit).toBe('USDC');
    const sweepPresets = buildSimulationPresets(sweepDraft);
    expect(sweepPresets.length).toBe(3);

    const trailDraft = toDraft(
      createWorkflowV2Recipe('trailing-stop', recipeValues),
      'Trailing stop',
    );
    const trailReqs = requiredSimulationInputs(trailDraft);
    expect(trailReqs.needsTrailingHigh).toBe(true);
    expect(trailReqs.needsPrice).toBe(true);
    const trailPresets = buildSimulationPresets(trailDraft);
    expect(trailPresets.some((p) => p.id === 'trailing-drop')).toBe(true);
    expect(trailPresets.some((p) => p.id === 'trailing-stop')).toBe(true);

    // Extreme 99.99% trailing preset produces valid positive prices
    const extremeTrailDraft = toDraft(
      createWorkflowV2Recipe('trailing-stop', { ...recipeValues, trailPercent: '99.99' }),
      'Extreme trail',
    );
    const extremePresets = buildSimulationPresets(extremeTrailDraft);
    const extremeDrop = extremePresets.find((p) => p.id === 'trailing-drop')!;
    expect(Number(extremeDrop.scenario.price)).toBeGreaterThan(0);
    expect(
      simulateWorkflowV2Draft(extremeTrailDraft, {
        ...emptySimulationScenario(),
        ...extremeDrop.scenario,
      }).outcome,
    ).toBe('would_execute');
  });
});
