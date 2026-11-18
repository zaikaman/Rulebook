import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { agentAbi } from '../src/abi/index.js';
import {
  DraftError,
  encodeAddRule,
  encodeAddRuleParams,
  missingSlots,
  readableSentence,
  ruleParamsFromDraft,
  ruleParamsHash,
} from '../src/encode.js';
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
      const expectedThreshold =
        hasSchedule && hasSecondary
          ? (draft.slots.schedule ?? '0')
          : (draft.slots.threshold ?? '0');
      const expectedSecondary =
        hasSchedule && !hasSecondary
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

  it('defaults makePublic to false and honours an explicit true', () => {
    const draft = drafts[0]?.draft;
    if (!draft) throw new Error('no fixture');
    const decode = (data: `0x${string}`) =>
      decodeFunctionData({ abi: agentAbi, data }).args as readonly [unknown, boolean];

    expect(decode(encodeAddRule(AGENT, draft))[1]).toBe(false);
    expect(decode(encodeAddRule(AGENT, draft, { makePublic: true }))[1]).toBe(true);
    expect(decode(encodeAddRule(AGENT, draft, { makePublic: false }))[1]).toBe(false);
  });
});

describe('ruleParamsFromDraft', () => {
  it('maps every fixture to the fields the registry hashes', () => {
    for (const { fixture, draft } of drafts) {
      const params = ruleParamsFromDraft(draft);
      expect(params.template).toBe(fixture.template);
      expect(params.chainId).toBe(CHAIN_ID);
      expect(String(params.amountIn)).toBe(BigInt(draft.slots.amount_in ?? '0').toString());
    }
  });

  it('matches the encoded calldata parameters', () => {
    for (const { draft } of drafts) {
      const params = ruleParamsFromDraft(draft);
      const decoded = decodeFunctionData({ abi: agentAbi, data: encodeAddRule(AGENT, draft) });
      const rule = decoded.args?.[0] as Record<string, unknown>;
      expect(rule.template).toBe(params.template);
      expect(rule.chainId).toBe(params.chainId);
      expect(rule.pair).toBe(params.pair);
      expect(rule.tokenIn).toBe(params.tokenIn);
      expect(rule.tokenOut).toBe(params.tokenOut);
      expect(rule.amountIn).toBe(params.amountIn);
      expect(rule.threshold).toBe(params.threshold);
      expect(rule.secondary).toBe(params.secondary);
    }
  });

  it('encodes stored parameters byte-for-byte like the draft path', () => {
    for (const { draft } of drafts) {
      const params = ruleParamsFromDraft(draft);
      expect(encodeAddRuleParams(AGENT, params, { makePublic: false })).toBe(
        encodeAddRule(AGENT, draft, { makePublic: false }),
      );
    }
  });

  it('rejects an incomplete draft instead of hashing zeros', () => {
    const draft = drafts[0]?.draft;
    if (!draft) throw new Error('no fixture');
    const slots = { ...draft.slots };
    const template = getTemplate(draft.template);
    const required = template?.slots.find((slot) => slot.required);
    if (!required) throw new Error('no required slot');
    delete slots[required.key];
    expect(() => ruleParamsFromDraft({ ...draft, slots })).toThrow(DraftError);
  });
});

describe('ruleParamsHash', () => {
  it('is stable for identical parameters', () => {
    const params = {
      template: 1,
      chainId: CHAIN_ID,
      pair: '0x1d8698365321D6DcE1F7141c380C866b012eE9dA' as const,
      tokenIn: '0x31d0220469e10c4E71834a79b1f276d740d3768F' as const,
      tokenOut: '0x4200000000000000000000000000000000000006' as const,
      amountIn: 10_000_000n,
      threshold: 0n,
      secondary: 604_800n,
    };
    expect(ruleParamsHash(params)).toBe(ruleParamsHash({ ...params }));
  });

  it('changes when any user-chosen parameter changes', () => {
    const base = {
      template: 1,
      chainId: CHAIN_ID,
      pair: '0x1d8698365321D6DcE1F7141c380C866b012eE9dA' as const,
      tokenIn: '0x31d0220469e10c4E71834a79b1f276d740d3768F' as const,
      tokenOut: '0x4200000000000000000000000000000000000006' as const,
      amountIn: 10_000_000n,
      threshold: 0n,
      secondary: 604_800n,
    };
    const hash = ruleParamsHash(base);
    expect(ruleParamsHash({ ...base, template: 2 })).not.toBe(hash);
    expect(ruleParamsHash({ ...base, chainId: 8453 })).not.toBe(hash);
    expect(ruleParamsHash({ ...base, amountIn: 20_000_000n })).not.toBe(hash);
    expect(ruleParamsHash({ ...base, threshold: 1n })).not.toBe(hash);
    expect(ruleParamsHash({ ...base, secondary: 1n })).not.toBe(hash);
    expect(
      ruleParamsHash({ ...base, tokenIn: '0x0000000000000000000000000000000000000001' }),
    ).not.toBe(hash);
  });
});
