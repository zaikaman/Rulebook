import { getChain, type TemplateSlot } from '@rulebook/shared';
import { formatUnits, parseUnits } from 'viem';

import { knownToken } from '../lib/signatures.js';

/** Price slots store quote-token units per base token, scaled by 1e18. */
const PRICE_DECIMALS = 18;
/** Percent slots store basis points, so two decimal places cover a hundredth of a percent. */
const PERCENT_DECIMALS = 2;

export type ScheduleUnit = 'hour' | 'day' | 'week';

export const SCHEDULE_UNIT_OPTIONS: readonly {
  readonly value: ScheduleUnit;
  readonly label: string;
}[] = [
  { value: 'hour', label: 'hours' },
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
];

const SCHEDULE_SECONDS: Readonly<Record<ScheduleUnit, bigint>> = {
  hour: 3_600n,
  day: 86_400n,
  week: 604_800n,
};

export type SlotParse = { readonly value: string } | { readonly error: string };

/** Numeric slots the user types as readable values instead of picking from a preset list. */
export function isTypedNumericSlot(slot: TemplateSlot): boolean {
  return (
    slot.kind === 'price' ||
    slot.kind === 'percent' ||
    slot.kind === 'schedule' ||
    slot.kind === 'duration'
  );
}

/** Expiry durations store a unix timestamp rather than a number of days. */
export function isExpirySlot(slot: TemplateSlot): boolean {
  return slot.kind === 'duration' && slot.unit === 'unix seconds';
}

/** The unit shown inside a numeric field, when the value needs one. */
export function slotInputSuffix(slot: TemplateSlot, chainId: number): string | undefined {
  switch (slot.kind) {
    case 'percent':
      return '%';
    case 'duration':
      return isExpirySlot(slot) ? undefined : 'days';
    case 'price': {
      const chain = getChain(chainId);
      const quote = knownToken(chainId, chain.usdc)?.symbol ?? 'USDC';
      const base = knownToken(chainId, chain.weth)?.symbol ?? 'WETH';
      return `${quote}/${base}`;
    }
    default:
      return undefined;
  }
}

/** Splits the stored "<count> <unit>" schedule text between the count and unit controls. */
export function parseScheduleText(text: string): {
  readonly count: string;
  readonly unit: ScheduleUnit;
} {
  const match = /^(.*?)\s*(hours?|days?|weeks?)$/i.exec(text.trim());
  const unit = (match?.[2] ?? 'days').toLowerCase().replace(/s$/, '') as ScheduleUnit;
  return { count: match?.[1]?.trim() ?? text.trim(), unit };
}

/** Rebuilds the schedule text from what the count and unit controls currently hold. */
export function scheduleText(count: string, unit: ScheduleUnit): string {
  const trimmed = count.trim();
  return trimmed ? `${trimmed} ${unit}` : '';
}

/** A local `datetime-local` value, which is what an expiry field edits. */
export function dateTimeInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function scheduleSeconds(text: string): SlotParse {
  const match = /^(\d+(?:\.\d{1,2})?)\s+(hours?|days?|weeks?)$/i.exec(text);
  const unit = (match?.[2] ?? '').toLowerCase().replace(/s$/, '') as ScheduleUnit;
  if (!match?.[1] || !SCHEDULE_SECONDS[unit]) {
    return { error: 'Enter how often the rule repeats, such as 1 day.' };
  }
  const count = parseUnits(match[1], 2);
  return { value: ((count * SCHEDULE_SECONDS[unit]) / 100n).toString() };
}

/** Converts a whole number of days to its canonical value. */
function wholeDays(text: string): SlotParse {
  if (!/^\d+$/.test(text)) return { error: 'Enter a whole number of days.' };
  return { value: text };
}

/**
 * Converts the text a numeric field holds into the integer the contract stores. Prices accept
 * decimals up to 1e18 precision, percentages up to a hundredth of a percent, schedules a count
 * plus a unit, and expiries a local date and time.
 */
export function textToCanonical(slot: TemplateSlot, text: string): SlotParse {
  const value = text.trim();
  if (slot.kind === 'schedule') return scheduleSeconds(value);
  if (isExpirySlot(slot)) {
    const milliseconds = new Date(value).valueOf();
    if (Number.isNaN(milliseconds)) return { error: 'Choose an expiry date and time.' };
    return { value: String(Math.floor(milliseconds / 1_000)) };
  }
  if (slot.kind === 'duration') return wholeDays(value);

  const isPrice = slot.kind === 'price';
  const decimals = isPrice ? PRICE_DECIMALS : PERCENT_DECIMALS;
  if (!/^\d*(?:\.\d*)?$/.test(value) || !value.replace('.', '')) {
    return {
      error: isPrice
        ? 'Enter a price using digits and a decimal point.'
        : 'Enter a percentage using digits and a decimal point.',
    };
  }
  if ((value.split('.')[1] ?? '').length > decimals) {
    return { error: `Use up to ${decimals} decimal places.` };
  }
  const amount = parseUnits(value, decimals);
  if (isPrice && amount <= 0n) return { error: 'Enter a price above zero.' };
  return { value: amount.toString() };
}

function scheduleLabel(seconds: bigint): string {
  for (const [unit, length] of Object.entries(SCHEDULE_SECONDS)) {
    if (seconds % length !== 0n) continue;
    const count = seconds / length;
    return `${count} ${count === 1n ? unit : `${unit}s`}`;
  }
  return `${formatUnits(seconds, 0)} seconds`;
}

/** Names a canonical minimum or maximum in the same units the field accepts. */
export function slotBoundMessage(slot: TemplateSlot, bound: string, edge: 'min' | 'max'): string {
  const amount = BigInt(bound);
  if (slot.kind === 'percent') {
    return `Enter ${formatUnits(amount, PERCENT_DECIMALS)}% ${edge === 'min' ? 'or more' : 'or less'}.`;
  }
  if (slot.kind === 'schedule') {
    return edge === 'min'
      ? `Repeat at least every ${scheduleLabel(amount)}.`
      : `Repeat at most every ${scheduleLabel(amount)}.`;
  }
  if (slot.kind === 'duration') {
    return `Enter ${amount} ${amount === 1n ? 'day' : 'days'} ${edge === 'min' ? 'or more' : 'or less'}.`;
  }
  return `Enter ${formatUnits(amount, PRICE_DECIMALS)} ${edge === 'min' ? 'or more' : 'or less'}.`;
}
