/** Round up to three significant digits without losing precision for small balances. */
export function roundUpFee(value: bigint) {
  const unit = 10n ** BigInt(Math.max(0, value.toString().length - 3));
  return ((value + unit - 1n) / unit) * unit;
}
