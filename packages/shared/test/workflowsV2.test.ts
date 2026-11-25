import { describe, expect, it } from 'vitest';

import {
  capIssue,
  createWorkflowV2Recipe,
  decodeWorkflowV2,
  draftSpending,
  emptyDraft,
  encodeWorkflowV2,
  fieldIssue,
  slippageIssue,
  toCopyDraft,
  toDraft,
  toProgram,
  validateWorkflowV2Program,
  workflowGuardrailFields,
  workflowV2Action,
  workflowV2Check,
  workflowV2Recipes,
  workflowV2Trigger,
  workflowV2Unit,
} from '../src/index.js';

const recipient = '0x0000000000000000000000000000000000000002';
const other = '0x0000000000000000000000000000000000000003';
const watched = '0x0000000000000000000000000000000000000004';
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
  watchedWallet: watched,
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

  it('names the wallet a large-transfer alert watches', () => {
    const program = createWorkflowV2Recipe('large-transfer-alert', values);
    expect(program.source).toBe(other);
    expect(program.subject).toBe(watched);
    expect(() =>
      createWorkflowV2Recipe('large-transfer-alert', { ...values, watchedWallet: '' }),
    ).toThrow('Enter a watched wallet address.');
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

describe('V2 marketplace copies', () => {
  it('keeps the listed per-run caps, watched wallet, and expiry', () => {
    const listing = createWorkflowV2Recipe('limit-buy', values);
    const copy = toCopyDraft(listing, 'Limit buy');
    expect(copy.title).toBe('Limit buy');
    expect(copy.expires).toBe(values.expiresAt);
    expect(copy.usdcCap).toBe('1.5');
    expect(copy.wethCap).toBe('');
  });

  it('clears payout recipients so the copier chooses them', () => {
    const listing = createWorkflowV2Recipe('recurring-transfer', values);
    const copy = toCopyDraft(listing, 'Recurring transfer');
    expect(copy.usdcCap).toBe('12');
    expect(copy.root).toEqual({
      steps: [
        { kind: workflowV2Action.send, unit: workflowV2Unit.fixed, amount: '12', recipient: '' },
      ],
    });
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
    const roundTripped = toDraft(program, 'Price alert');
    expect(roundTripped.usdcCap).toBe('');
    expect(roundTripped.slippage).toBe('');
    expect(() => toProgram(roundTripped)).not.toThrow();
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

const skipLeaf = { steps: [] };
const alertStep = {
  kind: workflowV2Action.alert,
  unit: workflowV2Unit.fixed,
  amount: '',
  recipient: '',
};
const sellStep = {
  kind: workflowV2Action.sell,
  unit: workflowV2Unit.fixed,
  amount: '0.001',
  recipient: '',
};
const sendStep = {
  kind: workflowV2Action.send,
  unit: workflowV2Unit.fixed,
  amount: '1',
  recipient,
};
const refillStep = {
  kind: workflowV2Action.refill,
  unit: workflowV2Unit.fixed,
  amount: '1',
  recipient: '',
};
const payoutStep = {
  kind: workflowV2Action.inactivityPayout,
  unit: workflowV2Unit.fixed,
  amount: '1',
  recipient,
};

describe('V2 on-chain constraint mirroring', () => {
  it('requires positive slippage when a draft swaps and rejects explicit zero slippage', () => {
    expect(slippageIssue('', true)).toBe(
      'Enter a maximum swap slippage because this workflow buys or sells WETH.',
    );
    expect(slippageIssue('', false)).toBeUndefined();
    expect(slippageIssue('0', false)).toBe('The maximum slippage must be between 0.01% and 10%.');
    expect(() =>
      toProgram({ ...scheduleDraft, usdcCap: '1', slippage: '', root: { steps: [buyStep] } }),
    ).toThrow('Enter a maximum swap slippage because this workflow buys or sells WETH.');
    expect(() =>
      toProgram({ ...scheduleDraft, usdcCap: '1', slippage: '0', root: { steps: [buyStep] } }),
    ).toThrow('The maximum slippage must be between 0.01% and 10%.');
  });

  it('rejects more than one swap on a single path while allowing swaps on separate branches', () => {
    expect(() =>
      toProgram({
        ...scheduleDraft,
        usdcCap: '1',
        wethCap: '0.001',
        slippage: '0.5',
        root: { steps: [buyStep, sellStep] },
      }),
    ).toThrow('A single path can include at most one buy or sell action.');

    const split = toProgram({
      ...emptyDraft(),
      title: 'Split swaps',
      trigger: workflowV2Trigger.price,
      usdcCap: '1',
      wethCap: '0.001',
      slippage: '0.5',
      root: {
        check: workflowV2Check.priceAtLeast,
        value: '2000',
        upper: '',
        yes: { steps: [sellStep] },
        no: { steps: [buyStep] },
      },
    });
    expect(() => validateWorkflowV2Program(split)).not.toThrow();
  });

  it('requires REFILL to sit inside the Yes branch of a USDC_BELOW check', () => {
    expect(() =>
      toProgram({ ...scheduleDraft, usdcCap: '1', root: { steps: [refillStep] } }),
    ).toThrow('Refill Vault USDC must be inside the Yes branch of a Vault USDC is below check.');

    expect(() =>
      toProgram({
        ...scheduleDraft,
        usdcCap: '1',
        root: {
          check: workflowV2Check.usdcBelow,
          value: '5',
          upper: '',
          yes: skipLeaf,
          no: { steps: [refillStep] },
        },
      }),
    ).toThrow('Refill Vault USDC must be inside the Yes branch of a Vault USDC is below check.');

    const valid = toProgram({
      ...scheduleDraft,
      usdcCap: '1',
      root: {
        check: workflowV2Check.usdcBelow,
        value: '5',
        upper: '',
        yes: {
          check: workflowV2Check.priceBelow,
          value: '2000',
          upper: '',
          yes: { steps: [refillStep] },
          no: skipLeaf,
        },
        no: skipLeaf,
      },
    });
    expect(() => validateWorkflowV2Program(valid)).not.toThrow();
  });

  it('enforces INACTIVITY_PAYOUT exclusivity, once flag, branch, and 24-hour minimum', () => {
    expect(() =>
      toProgram({
        ...scheduleDraft,
        usdcCap: '1',
        once: true,
        root: { steps: [payoutStep] },
      }),
    ).toThrow(
      'Send inactivity payout must be inside the Yes branch of a Wallet was inactive for check.',
    );

    expect(() =>
      toProgram({
        ...scheduleDraft,
        usdcCap: '2',
        once: true,
        root: {
          check: workflowV2Check.inactivity,
          value: '86400',
          upper: '',
          yes: { steps: [payoutStep, alertStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('Send inactivity payout cannot be combined with other actions on the same path.');

    expect(() =>
      toProgram({
        ...scheduleDraft,
        usdcCap: '1',
        once: false,
        root: {
          check: workflowV2Check.inactivity,
          value: '86400',
          upper: '',
          yes: { steps: [payoutStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('Enable "Close after a confirmed run" for an inactivity payout.');

    expect(() =>
      toProgram({
        ...scheduleDraft,
        usdcCap: '1',
        once: true,
        root: {
          check: workflowV2Check.inactivity,
          value: '86400',
          upper: '',
          yes: { steps: [sendStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('Only a single inactivity payout can run inside the Yes branch');

    expect(() =>
      toProgram({
        ...scheduleDraft,
        usdcCap: '1',
        once: true,
        root: {
          check: workflowV2Check.inactivity,
          value: '3600',
          upper: '',
          yes: { steps: [payoutStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('24 hours (86,400 seconds)');

    expect(() =>
      toProgram({
        ...scheduleDraft,
        usdcCap: '1',
        once: true,
        root: {
          check: workflowV2Check.inactivity,
          value: '86400',
          upper: '',
          yes: {
            check: workflowV2Check.priceBelow,
            value: '2000',
            upper: '',
            yes: { steps: [payoutStep] },
            no: { steps: [payoutStep] },
          },
          no: skipLeaf,
        },
      }),
    ).toThrow('A workflow can include at most one inactivity payout.');
  });

  it('requires PAYMENT trigger and non-empty subject for PAYMENT_FROM', () => {
    expect(() =>
      toProgram({
        ...scheduleDraft,
        root: {
          check: workflowV2Check.paymentFrom,
          value: '',
          upper: '',
          yes: { steps: [alertStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('Payment is from the specified wallet requires the Vault receives USDC trigger.');

    expect(() =>
      toProgram({
        ...emptyDraft(),
        title: 'From wallet',
        trigger: workflowV2Trigger.payment,
        subject: '',
        root: {
          check: workflowV2Check.paymentFrom,
          value: '',
          upper: '',
          yes: { steps: [alertStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('Enter a watched wallet address.');

    const valid = toProgram({
      ...emptyDraft(),
      title: 'From wallet',
      trigger: workflowV2Trigger.payment,
      subject: watched,
      root: {
        check: workflowV2Check.paymentFrom,
        value: '',
        upper: '',
        yes: { steps: [alertStep] },
        no: skipLeaf,
      },
    });
    expect(() => validateWorkflowV2Program(valid)).not.toThrow();
  });

  it('restricts percent-unit actions to PAYMENT trigger, SEND/BUY, and at most 100% per path', () => {
    const percentSend = {
      kind: workflowV2Action.send,
      unit: workflowV2Unit.percent,
      amount: '50',
      recipient,
    };
    expect(() =>
      toProgram({ ...scheduleDraft, usdcCap: '1', root: { steps: [percentSend] } }),
    ).toThrow('Percent of payment amounts require the Vault receives USDC trigger.');

    expect(() =>
      toProgram({
        ...emptyDraft(),
        title: 'Percent sell',
        trigger: workflowV2Trigger.payment,
        wethCap: '1',
        slippage: '0.5',
        root: {
          steps: [
            {
              kind: workflowV2Action.sell,
              unit: workflowV2Unit.percent,
              amount: '50',
              recipient: '',
            },
          ],
        },
      }),
    ).toThrow(
      'Percent of payment amounts are only supported for Send USDC and Buy WETH with USDC.',
    );

    expect(() =>
      toProgram({
        ...emptyDraft(),
        title: 'Over 100%',
        trigger: workflowV2Trigger.payment,
        usdcCap: '10',
        slippage: '0.5',
        root: {
          steps: [
            percentSend,
            {
              kind: workflowV2Action.buy,
              unit: workflowV2Unit.percent,
              amount: '60',
              recipient: '',
            },
          ],
        },
      }),
    ).toThrow('A single path can spend at most 100% of an incoming payment.');
  });

  it('rejects inverted PRICE_OUTSIDE ranges, out-of-range percentage checks, and mismatched check triggers', () => {
    expect(() =>
      toProgram({
        ...emptyDraft(),
        title: 'Bad range',
        trigger: workflowV2Trigger.price,
        root: {
          check: workflowV2Check.priceOutside,
          value: '3000',
          upper: '2000',
          yes: { steps: [alertStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('Set an upper price above the lower price.');

    expect(() =>
      toProgram({
        ...scheduleDraft,
        root: {
          check: workflowV2Check.dipBy,
          value: '100',
          upper: '',
          yes: { steps: [alertStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('The condition threshold must be between 0.01% and 99.99%.');

    expect(() =>
      toProgram({
        ...scheduleDraft,
        root: {
          check: workflowV2Check.amountAtLeast,
          value: '10',
          upper: '',
          yes: { steps: [alertStep] },
          no: skipLeaf,
        },
      }),
    ).toThrow('Amount is at least requires a payment or transfer trigger.');

    expect(() =>
      toProgram({
        ...scheduleDraft,
        expires: (1n << 64n).toString(),
        root: { steps: [alertStep] },
      }),
    ).toThrow('The expiry must be at most the contract maximum.');

    const inactivityAlert = toProgram({
      ...scheduleDraft,
      root: {
        check: workflowV2Check.inactivity,
        value: '86400',
        upper: '',
        yes: { steps: [alertStep] },
        no: skipLeaf,
      },
    });
    expect(() => validateWorkflowV2Program(inactivityAlert)).not.toThrow();
  });
});
