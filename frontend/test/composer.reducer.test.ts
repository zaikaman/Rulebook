import { TEMPLATES, getTemplate } from '@rulebook/shared';
import { describe, expect, it } from 'vitest';

import { canSign, composerReducer, initialComposerState } from '../src/composer/reducer.js';
import type { ComposerState } from '../src/composer/types.js';

function stateFor(template: number): ComposerState {
  return composerReducer(initialComposerState(1301), {
    type: 'selectTemplate',
    template: template as ComposerState['template'],
  });
}

describe('composer reducer', () => {
  it('setting a slot mutates exactly one parameter for all 13 templates', () => {
    for (const template of TEMPLATES) {
      for (const slot of template.slots) {
        const before = stateFor(template.id);
        const value = slot.kind === 'token' || slot.kind === 'address' ? '0x1111111111111111111111111111111111111111' : '5';
        const after = composerReducer(before, { type: 'setSlot', key: slot.key, value });

        expect(after.template).toBe(before.template);
        expect(after.chainId).toBe(before.chainId);
        const changed = Object.keys({ ...before.slots, ...after.slots }).filter(
          (key) => before.slots[key as keyof typeof before.slots] !== after.slots[key as keyof typeof after.slots],
        );
        expect(changed).toEqual([slot.key]);
        expect(after.slots[slot.key]).toBe(value);
      }
    }
  });

  it('clearing a required slot marks it missing and blocks signing', () => {
    for (const template of TEMPLATES) {
      const required = template.slots.find((slot) => slot.required);
      if (!required) throw new Error(`template ${template.id} has no required slot`);
      const filled = composerReducer(stateFor(template.id), {
        type: 'setSlot',
        key: required.key,
        value: required.kind === 'token' || required.kind === 'address' ? '0x1111111111111111111111111111111111111111' : '5',
      });
      const cleared = composerReducer(filled, { type: 'clearSlot', key: required.key });
      expect(cleared.slots[required.key]).toBeUndefined();
      expect(canSign(cleared)).toBe(false);
    }
  });

  it('changing template drops slots the new template does not have', () => {
    let state = stateFor(1);
    state = composerReducer(state, {
      type: 'setSlot',
      key: 'token_in',
      value: '0x1111111111111111111111111111111111111111',
    });
    state = composerReducer(state, {
      type: 'setSlot',
      key: 'amount_in',
      value: '10',
    });

    const alert = composerReducer(state, { type: 'selectTemplate', template: 11 });
    expect(alert.template).toBe(11);
    expect(alert.slots.token_in).toBeUndefined();
    expect(alert.slots.amount_in).toBeUndefined();
  });

  it('keeps a slot that the new template also declares', () => {
    let state = stateFor(1);
    state = composerReducer(state, {
      type: 'setSlot',
      key: 'threshold',
      value: '1000',
    });
    // Template 1 has no threshold, so the reducer never stored it.
    expect(state.slots.threshold).toBeUndefined();

    state = stateFor(3);
    state = composerReducer(state, { type: 'setSlot', key: 'threshold', value: '1000' });
    const next = composerReducer(state, { type: 'selectTemplate', template: 4 });
    expect(next.slots.threshold).toBe('1000');
  });

  it('refuses to sign an incomplete rule and an invalid percent', () => {
    const empty = stateFor(5);
    expect(canSign(empty)).toBe(false);

    const template = getTemplate(5);
    if (!template) throw new Error('template 5 missing');
    let state = empty;
    for (const slot of template.slots) {
      const value = slot.key === 'secondary' ? '10001' : slot.kind === 'token' || slot.kind === 'address' ? '0x1111111111111111111111111111111111111111' : '5';
      state = composerReducer(state, { type: 'setSlot', key: slot.key, value });
    }
    expect(canSign(state)).toBe(false);
  });

  it('reset clears every slot but keeps the chosen template', () => {
    let state = stateFor(7);
    state = composerReducer(state, {
      type: 'setSlot',
      key: 'amount_in',
      value: '10',
    });
    const reset = composerReducer(state, { type: 'reset' });
    expect(reset.template).toBe(7);
    expect(reset.slots).toEqual({});
  });
});
