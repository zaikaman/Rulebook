import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { agentAbi } from '../src/abi/index.js';
import { DraftError, encodeAddRule, missingSlots, readableSentence } from '../src/encode.js';
import { TEMPLATE_IDS, getTemplate } from '../src/generated/templates.js';
import { TEMPLATE_FIXTURES } from '../../contracts/test/templates/fixtures.generated.js';

const AGENT = '0x1111111111111111111111111111111111111111' as const;
const CHAIN_ID = 1301;

function draftFor(fixture: (typeof TEMPLATE_FIXTURES)[number]) {
  return { template: fixture.template, chainId: CHAIN_ID, slots: { ...fixture.slots } };
}

const drafts = TEMPLATE_FIXTURES.map((fixture) => ({ fixture, draft: draftFor(fixture) }));

describe('encodeAddRule', () => {
  it('has a fixture for all 13 templates', () => {
    expect(TEMPLATE_FIXTURES).toHaveLength(13);
    expect(TEMPLATE_FIXTURES.map((fixture) => fixture.template)).toEqual([...TEMPLATE_IDS]);
  });

  it.each(drafts)(
    'encodes template $fixture.template into addRule calldata',
    ({ fixture, draft }) => {
      const data = encodeAddRule(AGENT, draft);
      expect(data.startsWith('0x')).toBe(true);

      const decoded = decodeFunctionData({ abi: agentAbi, data }) as {
        functionName: string;
        args: readonly unknown[];
      };
      expect(decoded.functionName).toBe('addRule');

      const rule = decoded.args[0] as Record<string, unknown>;
      const template = getTemplate(fixture.template);
      expect(rule.template).toBe(fixture.template);
      expect(rule.chainId).toBe(CHAIN_ID);
      expect(String(rule.amountIn)).toBe(BigInt(draft.slots.amount_in ?? '0').toString());
      const hasSchedule = template?.slots.some((slot) => slot.key === 'schedule') ?? false;
      const hasSecondary = template?.slots.some((slot) => slot.key === 'secondary') ?? false;
      const expectedThreshold = hasSchedule && hasSecondary
        ? (draft.slots.schedule ?? '0')
        : (draft.slots.threshold ?? '0');
      const expectedSecondary = hasSchedule && !hasSecondary
        ? (draft.slots.schedule ?? '0')
        : (draft.slots.secondary ?? '0');
      expect(String(rule.threshold)).toBe(BigInt(expectedThreshold).toString());
      expect(String(rule.secondary)).toBe(BigInt(expectedSecondary).toString());
      if (draft.slots.token_in) expect(rule.tokenIn).toBe(draft.slots.token_in);
      if (draft.slots.token_out) expect(rule.tokenOut).toBe(draft.slots.token_out);
      if (template?.slots.some((slot) => slot.key === 'pair')) {
        expect(rule.pair).toBe(draft.slots.pair ?? '0x1d8698365321D6DcE1F7141c380C866b012eE9dA');
      }
    },
  );

  it('renders the same sentence as the generated fixture', () => {
    for (const { fixture, draft } of drafts) {
      expect(readableSentence(draft)).toBe(fixture.sentence);
    }
  });

  it('reports every missing required slot per template', () => {
    for (const { draft } of drafts) {
      const template = getTemplate(draft.template);
      for (const slot of template?.slots ?? []) {
        if (!slot.required) continue;
        const slots = { ...draft.slots };
        delete slots[slot.key];
        expect(missingSlots({ ...draft, slots })).toContain(slot.key);
        expect(() => encodeAddRule(AGENT, { ...draft, slots })).toThrow(DraftError);
      }
    }
  });

  it('rejects identical input and output tokens before encoding', () => {
    const draft = drafts.find((entry) => entry.fixture.template === 1)?.draft;
    expect(draft).toBeDefined();
    if (!draft) return;
    const conflicting = {
      ...draft,
      slots: { ...draft.slots, token_out: draft.slots.token_in },
    };
    expect(() => encodeAddRule(AGENT, conflicting)).toThrow(/must differ/);
  });

  it('rejects free-text slot keys', () => {
    const draft = drafts[0]?.draft;
    if (!draft) throw new Error('no fixture');
    expect(() =>
      encodeAddRule(AGENT, { ...draft, slots: { ...draft.slots, prompt: 'buy the dip' } }),
    ).toThrow(/Unknown slot/);
  });

  it('rejects a zero amount before encoding', () => {
    const draft = drafts.find((entry) => entry.fixture.template === 1)?.draft;
    if (!draft) throw new Error('no fixture');
    expect(() =>
      encodeAddRule(AGENT, { ...draft, slots: { ...draft.slots, amount_in: '0' } }),
    ).toThrow(/below its minimum/);
  });

  it('rejects a value that is not a number of the slot kind', () => {
    const draft = drafts[0]?.draft;
    if (!draft) throw new Error('no fixture');
    expect(() =>
      encodeAddRule(AGENT, { ...draft, slots: { ...draft.slots, amount_in: '10 USDC' } }),
    ).toThrow(/whole number/);
  });

  it('rejects a value that is not an address', () => {
    const draft = drafts[0]?.draft;
    if (!draft) throw new Error('no fixture');
    expect(() =>
      encodeAddRule(AGENT, { ...draft, slots: { ...draft.slots, token_in: 'usdc' } }),
    ).toThrow(/address/);
  });

  it('rejects an out-of-range percent', () => {
    const draft = drafts.find((entry) => entry.fixture.template === 5)?.draft;
    if (!draft) throw new Error('no fixture');
    expect(() =>
      encodeAddRule(AGENT, { ...draft, slots: { ...draft.slots, secondary: '10001' } }),
    ).toThrow(/above its maximum/);
  });

  it('rejects an unsupported chain', () => {
    const draft = drafts[0]?.draft;
    if (!draft) throw new Error('no fixture');
    expect(() => encodeAddRule(AGENT, { ...draft, chainId: 999 })).toThrow(/Unsupported chain/);
  });
});
