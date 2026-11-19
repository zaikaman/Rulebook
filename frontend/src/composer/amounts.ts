import type { TemplateSlot } from '@rulebook/shared';
import { formatUnits, maxUint256 } from 'viem';

type ParsedAmount = { readonly amount: bigint } | { readonly error: string };
const maxAmountDigits = maxUint256.toString().length;

/** Converts a token amount without floating-point arithmetic or rounding. */
export function parseDecimalAmount(value: string, decimals: number): ParsedAmount {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) {
    return { error: 'Enter a number such as 0.1 using a decimal point.' };
  }
  const whole = (match[1] ?? '').replace(/^0+/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > decimals) {
    return { error: `Use up to ${decimals} decimal places for this token.` };
  }
  const baseUnits = (whole + fraction.padEnd(decimals, '0')).replace(/^0+/, '');
  if (baseUnits.length > maxAmountDigits) return { error: 'This amount is too large.' };
  const amount = BigInt(baseUnits || '0');
  if (amount > maxUint256) return { error: 'This amount is too large.' };
  if (amount === 0n) return { error: 'Enter an amount greater than zero.' };
  return { amount };
}

export function amountCeiling(slot: TemplateSlot, vaultCeiling?: bigint): bigint | undefined {
  const templateCeiling = slot.max === null ? undefined : BigInt(slot.max);
  if (slot.key !== 'amount_in' || vaultCeiling === undefined) return templateCeiling;
  return templateCeiling !== undefined && templateCeiling < vaultCeiling
    ? templateCeiling
    : vaultCeiling;
}

export function tokenAmount(amount: bigint, token: { decimals: number; symbol: string }): string {
  return `${formatUnits(amount, token.decimals)} ${token.symbol}`;
}
