import { getTemplate } from '@rulebook/shared';
import { describe, expect, it } from 'vitest';

import {
  parseScheduleText,
  scheduleText,
  slotInputSuffix,
  textToCanonical,
} from '../src/composer/numericFields.js';

function slotOf(template: number, key: string) {
  const slot = getTemplate(template)?.slots.find((candidate) => candidate.key === key);
  if (!slot) throw new Error(`template ${template} has no ${key} slot`);
  return slot;
}

describe('numeric composer fields', () => {
  it('scales a typed price and percentage into contract units', () => {
    expect(textToCanonical(slotOf(3, 'threshold'), '1400')).toEqual({
      value: '1400000000000000000000',
    });
    expect(textToCanonical(slotOf(5, 'secondary'), '2.5')).toEqual({ value: '250' });
    expect(textToCanonical(slotOf(5, 'secondary'), '0.01')).toEqual({ value: '1' });
    expect(textToCanonical(slotOf(3, 'threshold'), '0')).toEqual({
      error: 'Enter a price above zero.',
    });
    expect(textToCanonical(slotOf(5, 'secondary'), '1.234')).toEqual({
      error: 'Use up to 2 decimal places.',
    });
  });

  it('converts repeat intervals and whole days', () => {
    expect(textToCanonical(slotOf(1, 'schedule'), '1 day')).toEqual({ value: '86400' });
    expect(textToCanonical(slotOf(1, 'schedule'), '2 weeks')).toEqual({ value: '1209600' });
    expect(textToCanonical(slotOf(1, 'schedule'), '0.5 hours')).toEqual({ value: '1800' });
    expect(textToCanonical(slotOf(1, 'schedule'), '')).toEqual({
      error: 'Enter how often the rule repeats, such as 1 day.',
    });
    expect(textToCanonical(slotOf(10, 'secondary'), '30')).toEqual({ value: '30' });
    expect(textToCanonical(slotOf(10, 'secondary'), '3.5')).toEqual({
      error: 'Enter a whole number of days.',
    });
  });

  it('turns a local expiry into a unix timestamp', () => {
    const expiry = '2099-01-01T00:00';
    expect(textToCanonical(slotOf(3, 'secondary'), expiry)).toEqual({
      value: String(new Date(expiry).getTime() / 1_000),
    });
  });

  it('splits and rebuilds the schedule text around its unit', () => {
    expect(parseScheduleText('3 weeks')).toEqual({ count: '3', unit: 'week' });
    expect(parseScheduleText('')).toEqual({ count: '', unit: 'day' });
    expect(scheduleText('2', 'hour')).toBe('2 hour');
    expect(scheduleText('', 'day')).toBe('');
  });

  it('labels each numeric field with the unit it expects', () => {
    expect(slotInputSuffix(slotOf(3, 'threshold'), 1301)).toBe('USDC/WETH');
    expect(slotInputSuffix(slotOf(5, 'secondary'), 1301)).toBe('%');
    expect(slotInputSuffix(slotOf(10, 'secondary'), 1301)).toBe('days');
    expect(slotInputSuffix(slotOf(3, 'secondary'), 1301)).toBeUndefined();
  });
});
