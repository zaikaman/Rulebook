import { describe, expect, it } from 'vitest';
import { decodeWorkflow, encodeWorkflow, type WorkflowDraft } from '../src/workflows.js';

const draft: WorkflowDraft = {
  title: 'Savings',
  trigger: 'payment',
  intervalHours: '24',
  price: '',
  rising: false,
  spendLimit: '1',
  slippage: '0.5',
  nodes: [
    { type: 'condition', amount: '0.25', yes: 1, no: 2 },
    {
      type: 'path',
      actions: [
        {
          kind: 'send',
          unit: 'percent',
          amount: '20',
          recipient: '0x1111111111111111111111111111111111111111',
        },
        { kind: 'alert', unit: 'fixed', amount: '', recipient: '' },
      ],
    },
    { type: 'path', actions: [] },
  ],
};

describe('workflow format', () => {
  it('round-trips a branch and preserves the exact signed fixed-point values', () => {
    const encoded = encodeWorkflow(draft);
    expect(encodeWorkflow(decodeWorkflow(encoded, draft.title))).toBe(encoded);
  });

  it('clears recipient and spend limit when copying', () => {
    const copy = decodeWorkflow(encodeWorkflow(draft), draft.title, true);
    expect(copy.spendLimit).toBe('');
    const path = copy.nodes[1];
    expect(path?.type === 'path' && path.actions[0]?.recipient).toBe('');
    expect(() => encodeWorkflow(copy)).toThrow();
  });

  it('rejects shared children, a spending overrun, and extra decimal precision', () => {
    expect(() =>
      encodeWorkflow({
        ...draft,
        nodes: [
          { type: 'condition', amount: '1', yes: 1, no: 1 },
          { type: 'path', actions: [] },
        ],
      }),
    ).toThrow();
    expect(() => encodeWorkflow({ ...draft, spendLimit: '0' })).toThrow('spending limit');
    expect(() => encodeWorkflow({ ...draft, spendLimit: '0.0000001' })).toThrow('spending limit');
  });
});
