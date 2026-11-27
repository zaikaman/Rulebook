import { formatUnits, parseUnits } from 'viem';

const PRICE_SCALE = 10n ** 18n;
const USDC_PER_WETH_SCALE = 10n ** 30n;
const BPS = 10_000;

export const MIN_SQRT_RATIO = 4_295_128_739n;
export const MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const Q192 = 1n << 192n;

export const POOL_PRICE_OFFSET_PRESETS = [
  { label: '-5%', bps: -500 },
  { label: '-2%', bps: -200 },
  { label: 'Spot', bps: 0 },
  { label: '+5%', bps: 500 },
  { label: '+10%', bps: 1_000 },
] as const;

export type PoolPriceOffsetPreset = (typeof POOL_PRICE_OFFSET_PRESETS)[number];

/**
 * Computes USDC per WETH scaled by 1e18 from Uniswap V2 pair reserves,
 * matching `PriceMath.usdcPerWeth` in Solidity.
 */
export function usdcPerWethFromReserves(
  reserve0: bigint,
  reserve1: bigint,
  usdcIsToken0: boolean,
): bigint {
  const usdcReserve = usdcIsToken0 ? reserve0 : reserve1;
  const wethReserve = usdcIsToken0 ? reserve1 : reserve0;
  if (usdcReserve <= 0n || wethReserve <= 0n) {
    throw new Error('Pool has no active liquidity.');
  }
  const price = (usdcReserve * USDC_PER_WETH_SCALE) / wethReserve;
  if (price <= 0n) {
    throw new Error('Pool has no active liquidity.');
  }
  return price;
}

/**
 * Computes USDC per WETH scaled by 1e18 from a Uniswap V3 `sqrtPriceX96`,
 * matching `PriceMath.usdcPerWethFromSqrtPriceX96` in Solidity.
 */
export function usdcPerWethFromSqrtPriceX96(sqrtPriceX96: bigint, usdcIsToken0: boolean): bigint {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
    throw new Error('Pool price is out of bounds.');
  }
  const ratioX192 = sqrtPriceX96 * sqrtPriceX96;
  const price = usdcIsToken0
    ? (Q192 * USDC_PER_WETH_SCALE) / ratioX192
    : (ratioX192 * USDC_PER_WETH_SCALE) / Q192;
  if (price <= 0n) {
    throw new Error('Pool has no active liquidity.');
  }
  return price;
}

/** Applies a signed basis-point offset to a 1e18-scaled spot price. */
export function applyPriceOffsetBps(spotPrice: bigint, offsetBps: number): bigint {
  if (spotPrice <= 0n) {
    throw new Error('Spot price must be greater than zero.');
  }
  if (!Number.isInteger(offsetBps) || BPS + offsetBps <= 0) {
    throw new Error('Price offset must leave a positive price.');
  }
  const adjusted = (spotPrice * BigInt(BPS + offsetBps)) / BigInt(BPS);
  return adjusted > 0n ? adjusted : 1n;
}

function roundScaledDecimal(value: bigint, decimals: number, keepDecimals: number): bigint {
  if (keepDecimals >= decimals) return value;
  const divisor = 10n ** BigInt(decimals - keepDecimals);
  const remainder = value % divisor;
  const rounded = value / divisor + (remainder * 2n >= divisor ? 1n : 0n);
  return rounded * divisor;
}

function roundPoolPrice(price: bigint): bigint {
  if (price >= 100n * PRICE_SCALE) {
    return roundScaledDecimal(price, 18, 2);
  }
  if (price >= PRICE_SCALE) {
    return roundScaledDecimal(price, 18, 4);
  }
  const [, frac = ''] = formatUnits(price, 18).split('.');
  const firstNonZero = frac.search(/[1-9]/);
  if (firstNonZero === -1) return price;
  const keepDecimals = Math.min(18, firstNonZero + 6);
  const rounded = roundScaledDecimal(price, 18, keepDecimals);
  return rounded > 0n ? rounded : price;
}

function formatWithGroupedInteger(text: string): string {
  const [intPart = '0', fracPart] = text.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart !== undefined ? `${grouped}.${fracPart}` : grouped;
}

/** Formats a 1e18-scaled USDC/WETH price into a clean decimal string suitable for form inputs. */
export function formatPoolPriceInput(price: bigint): string {
  if (price <= 0n) return '0';
  const rounded = roundPoolPrice(price);
  const formatted = formatUnits(rounded, 18);
  if (!formatted.includes('.')) return formatted;
  return formatted.replace(/0+$/, '').replace(/\.$/, '');
}

/** Formats a 1e18-scaled USDC/WETH price for display in the inline spot readout. */
export function formatPoolPriceDisplay(price: bigint): string {
  if (price <= 0n) return '0.00';
  const rounded = roundPoolPrice(price);
  const raw = formatUnits(rounded, 18);
  const [intPart = '0', fracPart = ''] = raw.split('.');
  if (rounded >= 100n * PRICE_SCALE) {
    return formatWithGroupedInteger(`${intPart}.${fracPart.padEnd(2, '0').slice(0, 2)}`);
  }
  if (rounded >= PRICE_SCALE) {
    const trimmed = fracPart.replace(/0+$/, '');
    const padded = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed;
    return formatWithGroupedInteger(`${intPart}.${padded}`);
  }
  const trimmed = fracPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

/** Summarizes how an entered price compares to the live spot price (e.g. `-5.0% vs spot`). */
export function formatRelativeToSpot(inputValue: string, spotPrice: bigint): string | null {
  const trimmed = inputValue.trim();
  if (!trimmed || !/^\d+(?:\.\d{1,18})?$/.test(trimmed) || spotPrice <= 0n) {
    return null;
  }
  const target = parseUnits(trimmed, 18);
  if (target <= 0n) return null;
  const diff = target - spotPrice;
  const absDiff = diff >= 0n ? diff : -diff;
  const absTenths = (absDiff * 1_000n + spotPrice / 2n) / spotPrice;
  if (absTenths === 0n) return 'At spot';
  if (absTenths > 9_999n) return diff > 0n ? '>+999% vs spot' : '<-999% vs spot';
  const sign = diff > 0n ? '+' : '-';
  const whole = absTenths / 10n;
  const frac = absTenths % 10n;
  return `${sign}${whole}.${frac}% vs spot`;
}
