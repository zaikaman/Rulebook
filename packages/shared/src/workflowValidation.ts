import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address } from 'viem';

/**
 * Field validation for the workflow builder. Every message names the field, the accepted unit,
 * and the exact bound, so a rejected value tells the user what to change instead of echoing an
 * internal key.
 */
export interface AmountFieldRules {
  /** Sentence subject, for example "The interval". */
  readonly subject: string;
  /** Lowercase noun with its article, for example "an interval". */
  readonly noun: string;
  readonly decimals: number;
  /** Displayed after the value, for example "USDC", "seconds", or "%". */
  readonly unit?: string;
  readonly minimum?: bigint;
  readonly maximum?: bigint;
  /** Overrides the formatted minimum in range messages. */
  readonly minimumText?: string;
  /** Overrides the formatted maximum in range messages. */
  readonly maximumText?: string;
  /** Replaces the whole bound phrase, for prices such as "greater than zero". */
  readonly range?: string;
  /** A Unix timestamp that must be later than now. */
  readonly future?: boolean;
  readonly optional?: boolean;
}

function boundText(
  value: bigint,
  decimals: number,
  unit: string | undefined,
  override: string | undefined,
) {
  if (override) return override;
  const formatted = formatUnits(value, decimals);
  if (!unit) return formatted;
  return unit === '%' ? `${formatted}%` : `${formatted} ${unit}`;
}

function rangeMessage(rules: AmountFieldRules) {
  if (rules.range) return `${rules.subject} must be ${rules.range}.`;
  const minimum =
    rules.minimum === undefined
      ? undefined
      : boundText(rules.minimum, rules.decimals, rules.unit, rules.minimumText);
  const maximum =
    rules.maximum === undefined
      ? undefined
      : boundText(rules.maximum, rules.decimals, rules.unit, rules.maximumText);
  if (minimum && maximum) return `${rules.subject} must be between ${minimum} and ${maximum}.`;
  if (minimum) return `${rules.subject} must be at least ${minimum}.`;
  if (maximum) return `${rules.subject} must be at most ${maximum}.`;
  return undefined;
}

/** Returns the first reason a numeric field is not acceptable, or undefined when it is. */
export function amountIssue(value: string | undefined, rules: AmountFieldRules) {
  const text = value?.trim() ?? '';
  if (!text) return rules.optional ? undefined : `Enter ${rules.noun}.`;
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    return rules.decimals === 0
      ? `Enter ${rules.noun} as a whole number.`
      : `Enter ${rules.noun} using digits and a decimal point.`;
  }
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length > rules.decimals) {
    return `Use up to ${rules.decimals} decimal places for ${rules.noun}.`;
  }
  const amount = parseUnits(text, rules.decimals);
  if (rules.minimum !== undefined && amount < rules.minimum) return rangeMessage(rules);
  if (rules.maximum !== undefined && amount > rules.maximum) return rangeMessage(rules);
  if (rules.future && amount <= BigInt(Math.floor(Date.now() / 1_000))) {
    return `Choose ${rules.noun} in the future.`;
  }
  return undefined;
}

export function readAmountField(value: string | undefined, rules: AmountFieldRules) {
  const issue = amountIssue(value, rules);
  if (issue) throw new Error(issue);
  const text = value?.trim() ?? '';
  return text ? parseUnits(text, rules.decimals) : 0n;
}

export interface AddressFieldRules {
  /** Lowercase noun with its article, for example "a recipient address". */
  readonly noun: string;
  readonly optional?: boolean;
}

export function addressIssue(value: string | undefined, rules: AddressFieldRules) {
  const text = value?.trim() ?? '';
  if (!text) return rules.optional ? undefined : `Enter ${rules.noun}.`;
  if (!isAddress(text, { strict: false })) {
    return `Enter ${rules.noun} as a 0x value with 40 hexadecimal characters.`;
  }
  if (text.toLowerCase() === zeroAddress) {
    return `Enter ${rules.noun} other than the zero address.`;
  }
  return undefined;
}

export function readAddressField(value: string | undefined, rules: AddressFieldRules): Address {
  const issue = addressIssue(value, rules);
  if (issue) throw new Error(issue);
  const text = value?.trim() ?? '';
  return text ? getAddress(text) : zeroAddress;
}
