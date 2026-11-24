import { describe, expect, it } from 'vitest';

import {
  capIssue,
  createWorkflowV2Recipe,
  decodeWorkflowV2,
  draftSpending,
  emptyDraft,
  encodeWorkflowV2,
  fieldIssue,
  toDraft,
  toProgram,
  workflowGuardrailFields,
  workflowV2Action,
  workflowV2Recipes,
  workflowV2Unit,
} from '../src/index.js';

const recipient = '0x0000000000000000000000000000000000000002';
const other = '0x0000000000000000000000000000000000000003';
const values = {
  intervalSeconds: '3600',
  expiresAt: '1900000000',
  buyUsdc: '1.5',
  sellWeth: '0.001',
  slippagePercent: '0.5',
  dipPercent: '5',
  limitPrice: '1500',
  targetPrice: '2500',
  stopPrice: '1250',
  trailPercent: '8',
  bandPercent: '5',
  referencePrice: '2000',
  recipient,
  sendUsdc: '12',
  minimumPaymentUsdc: '15',
  floorUsdc: '4',
  refillUsdc: '2',
  inactivitySeconds: '604800',
  direction: 'rising',
  lowerPrice: '1000',
  upperPrice: '3000',
  token: other,
  minimumTransferRaw: '1000000',
};

describe('V2 recipe programs', () => {
  it('exposes exactly the original 13 recipes', () => {
    expect(new Set(workflowV2Recipes.map(({ id }) => id)).size).toBe(13);
  });

  it.each(workflowV2Recipes)(
    'round-trips $title through the generated contract ABI',
    ({ id, chain, trigger }) => {
      const program = createWorkflowV2Recipe(id, values, { inactivityPayout: true });
      expect(program.chain).toBe(chain);
      expect(program.trigger).toBe(trigger);
      expect(program.nodes.some(({ actions }) => actions.length > 0)).toBe(true);
      expect(decodeWorkflowV2(encodeWorkflowV2(program))).toEqual(program);
    },
  );

  it('requires a fixed recipient and explicit consent for inactivity payouts', () => {
    expect(() => createWorkflowV2Recipe('inactivity-payout', values)).toThrow('Confirm');
    expect(() =>
      createWorkflowV2Recipe(
        'inactivity-payout',
        { ...values, recipient: '' },
        { inactivityPayout: true },
      ),
    ).toThrow('recipient');
    const payout = createWorkflowV2Recipe('inactivity-payout', values, {
      inactivityPayout: true,
    });
    expect(payout.once).toBe(true);
    expect(payout.nodes[1]?.actions[0]?.account).toBe(recipient);
  });

  it('names the accepted range when a recipe input is out of bounds', () => {
    expect(() =>
      createWorkflowV2Recipe('scheduled-buy', { ...values, intervalSeconds: '1' }),
    ).toThrow(
      'The interval must be between 2 minutes (120 seconds) and 30 days (2,592,000 seconds).',
    );
    expect(() => createWorkflowV2Recipe('scheduled-buy', { ...values, buyUsdc: '0' })).toThrow(
      'The USDC amount must be between 0.000001 USDC and the contract maximum.',
    );
    expect(() => createWorkflowV2Recipe('limit-buy', { ...values, limitPrice: '0' })).toThrow(
      'The limit price must be greater than zero.',
    );
    expect(() =>
      createWorkflowV2Recipe('limit-buy', {
        ...values,
        expiresAt: String(Math.floor(Date.now() / 1_000) - 60),
      }),
    ).toThrow('Choose an expiry time in the future.');
    expect(() =>
      createWorkflowV2Recipe('income-sweep', { ...values, smallPaymentUsdc: '5' }),
    ).toThrow(
      'Enter both the smaller payment threshold and the smaller sweep, or leave both blank.',
    );
  });

  it('retains both trading caps and supports two qualifying sweep paths', () => {
    const sweep = createWorkflowV2Recipe('income-sweep', {
      ...values,
      smallPaymentUsdc: '5',
      smallSweepUsdc: '1',
    });
    expect(sweep.nodes.filter((node) => node.actions.length > 0)).toHaveLength(2);
    const band = createWorkflowV2Recipe('price-band', values);
    expect(band.usdcCap).toBe(1_500_000n);
    expect(band.wethCap).toBe(1_000_000_000_000_000n);
  });
});

const scheduleDraft = { ...emptyDraft(), title: 'Scheduled buy', interval: '3600' };
const buyStep = {
  kind: workflowV2Action.buy,
  unit: workflowV2Unit.fixed,
  amount: '1',
  recipient: '',
};

describe('V2 per-run caps', () => {
  it('requires a cap for every asset the workflow can spend', () => {
    const draft = { ...scheduleDraft, slippage: '0.5', root: { steps: [buyStep] } };
    expect(draftSpending(draft)).toEqual({ usdc: true, weth: false });
    expect(() => toProgram(draft)).toThrow(
      'Enter a per-run USDC cap because this workflow spends USDC.',
    );
    expect(capIssue('USDC', draft.usdcCap, true)).toBe(
      'Enter a per-run USDC cap because this workflow spends USDC.',
    );
    expect(capIssue('WETH', draft.wethCap, false)).toBeUndefined();
  });

  it('rejects a cap below the largest spend in one path', () => {
    expect(() =>
      toProgram({ ...scheduleDraft, slippage: '0.5', usdcCap: '0.5', root: { steps: [buyStep] } }),
    ).toThrow(
      'The per-run USDC cap is 0.5 USDC, but one run can spend 1 USDC. Raise the cap or lower the spend.',
    );
    expect(
      toProgram({ ...scheduleDraft, slippage: '0.5', usdcCap: '1', root: { steps: [buyStep] } })
        .usdcCap,
    ).toBe(1_000_000n);
  });

  it('allows blank caps only when the workflow does not spend', () => {
    const program = toProgram({
      ...scheduleDraft,
      root: {
        steps: [
          { kind: workflowV2Action.alert, unit: workflowV2Unit.fixed, amount: '', recipient: '' },
        ],
      },
    });
    expect(program.usdcCap).toBe(0n);
    expect(program.wethCap).toBe(0n);
    expect(toDraft(program, 'Price alert').usdcCap).toBe('');
  });

  it('rejects an explicit zero cap', () => {
    expect(fieldIssue(workflowGuardrailFields.usdcCap, '0')).toBe(
      'The per-run USDC cap must be between 0.000001 USDC and the contract maximum.',
    );
    expect(fieldIssue(workflowGuardrailFields.wethCap, '0')).toBe(
      'The per-run WETH cap must be between 0.000000000000000001 WETH and the contract maximum.',
    );
  });
});
