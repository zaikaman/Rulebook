import { parseEther, parseGwei } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  EXECUTION_ESTIMATED_GAS_PER_RUN,
  LASNA_CHAIN_ID,
  MAX_DISPLAYED_RUNWAY_RUNS,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  WATCHING_ESTIMATED_GAS_PER_RUN,
  estimateCreditRunway,
  estimateRunCostWei,
  estimatedGasPerRun,
  estimatedGasPerRunLabel,
  feeCreditWarningThreshold,
  formatRunwayRuns,
} from '../src/index.js';

describe('feeCredit', () => {
  it('returns network-specific warning thresholds', () => {
    expect(feeCreditWarningThreshold(LASNA_CHAIN_ID)).toBe(parseEther('0.05'));
    expect(feeCreditWarningThreshold(REACTIVE_MAINNET_CHAIN_ID)).toBe(parseEther('0.5'));
    expect(feeCreditWarningThreshold(UNICHAIN_SEPOLIA_CHAIN_ID)).toBe(parseEther('0.0001'));
    expect(feeCreditWarningThreshold(BASE_SEPOLIA_CHAIN_ID)).toBe(parseEther('0.0001'));
    expect(feeCreditWarningThreshold(UNICHAIN_MAINNET_CHAIN_ID)).toBe(parseEther('0.001'));
    expect(feeCreditWarningThreshold(BASE_MAINNET_CHAIN_ID)).toBe(parseEther('0.001'));
  });

  it('exposes gas estimates and run costs per credit kind', () => {
    expect(estimatedGasPerRun('watching')).toBe(WATCHING_ESTIMATED_GAS_PER_RUN);
    expect(estimatedGasPerRun('execution')).toBe(EXECUTION_ESTIMATED_GAS_PER_RUN);
    expect(estimatedGasPerRunLabel('watching')).toBe('~200k gas per trigger check');
    expect(estimatedGasPerRunLabel('execution')).toBe('~350k gas per settlement callback');

    expect(estimateRunCostWei('watching', 0n, 100_000n, 1000n)).toBeNull();
    expect(estimateRunCostWei('execution', -1n, 80_000n, 1100n)).toBeNull();
    expect(estimateRunCostWei('watching', parseGwei('2'), 100_000n, 1000n)).toBe(
      parseEther('0.0006'),
    );
    expect(estimateRunCostWei('execution', parseGwei('1'), 80_000n, 1100n)).toBe(
      parseEther('0.000473'),
    );
  });

  it('computes net runway after subtracting debt and handles edge cases', () => {
    expect(
      estimateCreditRunway({
        reserveWei: parseEther('0.1'),
        estimatedCostPerRunWei: 0n,
      }),
    ).toBeNull();

    // 0.1 ETH at 2 gwei * 200k gas (0.0004 ETH/run) -> 250 runs
    const exact = estimateCreditRunway({
      reserveWei: parseEther('0.1'),
      estimatedCostPerRunWei: parseEther('0.0004'),
    });
    expect(exact).not.toBeNull();
    expect(exact!.runs).toBe(250);
    expect(exact!.capped).toBe(false);
    expect(exact!.underOneRun).toBe(false);
    expect(exact!.depleted).toBe(false);
    expect(formatRunwayRuns(exact!)).toBe('~250 runs covered');
    expect(formatRunwayRuns(exact!, { suffix: 'none' })).toBe('~250 runs');

    // Debt reduces net reserve: 0.05 - 0.03 = 0.02 -> 50 runs at 0.0004/run
    const withDebt = estimateCreditRunway({
      reserveWei: parseEther('0.05'),
      debtWei: parseEther('0.03'),
      estimatedCostPerRunWei: parseEther('0.0004'),
    });
    expect(withDebt!.runs).toBe(50);
    expect(formatRunwayRuns(withDebt!)).toBe('~50 runs covered');

    // Debt equal to or exceeding reserve yields 0 runs depleted
    const debtEquals = estimateCreditRunway({
      reserveWei: parseEther('0.001'),
      debtWei: parseEther('0.001'),
      estimatedCostPerRunWei: parseEther('0.00035'),
    });
    expect(debtEquals!.depleted).toBe(true);
    expect(formatRunwayRuns(debtEquals!)).toBe('0 runs covered');

    const debtExceeds = estimateCreditRunway({
      reserveWei: parseEther('0.001'),
      debtWei: parseEther('0.002'),
      estimatedCostPerRunWei: parseEther('0.00035'),
    });
    expect(debtExceeds!.netReserveWei).toBe(0n);
    expect(debtExceeds!.depleted).toBe(true);
    expect(formatRunwayRuns(debtExceeds!)).toBe('0 runs covered');

    // Non-zero net reserve below 1 run cost yields `< 1 run covered`
    const underOne = estimateCreditRunway({
      reserveWei: parseEther('0.0001'),
      estimatedCostPerRunWei: parseEther('0.00035'), // 1 run = 0.00035 ETH
    });
    expect(underOne!.underOneRun).toBe(true);
    expect(underOne!.depleted).toBe(false);
    expect(formatRunwayRuns(underOne!)).toBe('< 1 run covered');

    // Exactly 1 run uses singular form
    const oneRun = estimateCreditRunway({
      reserveWei: parseEther('0.00035'),
      estimatedCostPerRunWei: parseEther('0.00035'),
    });
    expect(oneRun!.runs).toBe(1);
    expect(formatRunwayRuns(oneRun!)).toBe('~1 run covered');
    expect(formatRunwayRuns(oneRun!, { suffix: 'none' })).toBe('~1 run');

    // Very low L2 gas price caps cleanly at 1,000+ runs
    const capped = estimateCreditRunway({
      reserveWei: parseEther('0.01'),
      estimatedCostPerRunWei: parseEther('0.00000035'),
    });
    expect(capped!.capped).toBe(true);
    expect(capped!.runs).toBe(MAX_DISPLAYED_RUNWAY_RUNS);
    expect(formatRunwayRuns(capped!)).toBe('1,000+ runs covered');
    expect(formatRunwayRuns(capped!, { suffix: 'none' })).toBe('1,000+ runs');
  });
});
