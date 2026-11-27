import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  applyPriceOffsetBps,
  formatPoolPriceDisplay,
  formatPoolPriceInput,
  formatRelativeToSpot,
  POOL_PRICE_OFFSET_PRESETS,
  usdcPerWethFromReserves,
  usdcPerWethFromSqrtPriceX96,
} from '../src/index.js';

describe('poolPrice', () => {
  it('computes spot price from Uniswap V2 reserves regardless of token0 order', () => {
    const usdcReserve = 250_000_000_000n; // 250,000 USDC (6 decimals)
    const wethReserve = 100n * 10n ** 18n; // 100 WETH (18 decimals)

    expect(usdcPerWethFromReserves(usdcReserve, wethReserve, true)).toBe(parseUnits('2500', 18));
    expect(usdcPerWethFromReserves(wethReserve, usdcReserve, false)).toBe(parseUnits('2500', 18));
  });

  it('rejects empty or zero-reserve V2 pools', () => {
    expect(() => usdcPerWethFromReserves(0n, 100n * 10n ** 18n, true)).toThrow(
      'Pool has no active liquidity.',
    );
    expect(() => usdcPerWethFromReserves(100_000_000n, 0n, true)).toThrow(
      'Pool has no active liquidity.',
    );
  });

  it('computes spot price from Uniswap V3 sqrtPriceX96 for both token0 orders', () => {
    // When USDC (6 dec) is token0 and WETH (18 dec) is token1, token1/token0 = 1e12 / 2500 = 4e8.
    // sqrt(4e8) = 20_000, so sqrtPriceX96 = 20_000 * 2^96.
    const sqrtWhenUsdc0 = 20_000n * (1n << 96n);
    expect(usdcPerWethFromSqrtPriceX96(sqrtWhenUsdc0, true)).toBe(parseUnits('2500', 18));

    // When WETH is token0 and USDC is token1, token1/token0 = 2500 / 1e12 = 25e-10.
    // sqrt(25e-10) = 5e-5, so sqrtPriceX96 = (2^96) / 20_000.
    const sqrtWhenWeth0 = (1n << 96n) / 20_000n;
    const priceWeth0 = usdcPerWethFromSqrtPriceX96(sqrtWhenWeth0, false);
    expect(priceWeth0).toBeGreaterThan(parseUnits('2499', 18));
    expect(priceWeth0).toBeLessThanOrEqual(parseUnits('2500', 18));
  });

  it('applies basis-point offsets cleanly and rejects invalid offsets', () => {
    const spot = parseUnits('2500', 18);
    expect(applyPriceOffsetBps(spot, -500)).toBe(parseUnits('2375', 18));
    expect(applyPriceOffsetBps(spot, -200)).toBe(parseUnits('2450', 18));
    expect(applyPriceOffsetBps(spot, 0)).toBe(parseUnits('2500', 18));
    expect(applyPriceOffsetBps(spot, 500)).toBe(parseUnits('2625', 18));
    expect(applyPriceOffsetBps(spot, 1000)).toBe(parseUnits('2750', 18));
    expect(POOL_PRICE_OFFSET_PRESETS.map((preset) => preset.label)).toEqual([
      '-5%',
      '-2%',
      'Spot',
      '+5%',
      '+10%',
    ]);
    expect(() => applyPriceOffsetBps(0n, 500)).toThrow();
    expect(() => applyPriceOffsetBps(spot, -10_000)).toThrow();
  });

  it('formats input and display strings across price magnitudes without precision loss', () => {
    expect(formatPoolPriceInput(parseUnits('2500', 18))).toBe('2500');
    expect(formatPoolPriceInput(parseUnits('2500.126', 18))).toBe('2500.13');
    expect(formatPoolPriceInput(parseUnits('12.34567', 18))).toBe('12.3457');
    expect(formatPoolPriceInput(parseUnits('0.004215678', 18))).toBe('0.00421568');
    expect(formatPoolPriceInput(1n)).toBe('0.000000000000000001');

    expect(formatPoolPriceDisplay(parseUnits('2500', 18))).toBe('2,500.00');
    expect(formatPoolPriceDisplay(parseUnits('12.3', 18))).toBe('12.30');
    expect(formatPoolPriceDisplay(parseUnits('12.34567', 18))).toBe('12.3457');
    expect(formatPoolPriceDisplay(parseUnits('0.004215678', 18))).toBe('0.00421568');
  });

  it('formats entered target prices relative to live spot', () => {
    const spot = parseUnits('2500', 18);
    expect(formatRelativeToSpot('', spot)).toBeNull();
    expect(formatRelativeToSpot('abc', spot)).toBeNull();
    expect(formatRelativeToSpot('0', spot)).toBeNull();
    expect(formatRelativeToSpot('2500', spot)).toBe('At spot');
    expect(formatRelativeToSpot('2375', spot)).toBe('-5.0% vs spot');
    expect(formatRelativeToSpot('2625', spot)).toBe('+5.0% vs spot');
    expect(formatRelativeToSpot('500000', spot)).toBe('>+999% vs spot');
  });
});
