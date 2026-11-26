import { describe, expect, it } from 'vitest';
import { parseEther, parseGwei } from 'viem';

import {
  DEFAULT_GAS_ESTIMATE_MULTIPLIER,
  LASNA_DEFAULT_FEE_CAP,
  MAINNET_CHAINS,
  REACTIVE_MAINNET_DEFAULT_FEE_CAP,
  TESTNET_CHAINS,
  computeAutomationGasPlan,
  resolveFeeCap,
  resolveGasEstimateMultiplier,
} from '../../scripts/deploy-workflows-v2.mjs';

const LIVE_MAINNET_ESTIMATED_GAS = 8_543_324n;

describe('deploy-workflows-v2 gas planning', () => {
  describe('resolveFeeCap', () => {
    it('uses separate default fee caps for Reactive Lasna and Reactive Mainnet', () => {
      expect(LASNA_DEFAULT_FEE_CAP).toBe(parseEther('0.95'));
      expect(REACTIVE_MAINNET_DEFAULT_FEE_CAP).toBe(parseEther('5'));
      expect(resolveFeeCap(TESTNET_CHAINS.lasna, {})).toBe(parseEther('0.95'));
      expect(resolveFeeCap(MAINNET_CHAINS.reactive, {})).toBe(parseEther('5'));
    });

    it('accepts valid environment overrides for both chains', () => {
      expect(resolveFeeCap(MAINNET_CHAINS.reactive, { REACTIVE_MAINNET_FEE_CAP: ' 3.5 ' })).toBe(
        parseEther('3.5'),
      );
      expect(resolveFeeCap(TESTNET_CHAINS.lasna, { LASNA_FEE_CAP: '1.25' })).toBe(
        parseEther('1.25'),
      );
    });

    it('rejects non-positive or malformed fee cap overrides', () => {
      for (const bad of ['0', '0.0', '-1', 'abc', '1e18', '1.1234567890123456789']) {
        expect(() =>
          resolveFeeCap(MAINNET_CHAINS.reactive, { REACTIVE_MAINNET_FEE_CAP: bad }),
        ).toThrow(/REACTIVE_MAINNET_FEE_CAP must be a positive REACT amount/);
      }
    });
  });

  describe('resolveGasEstimateMultiplier', () => {
    it('defaults to Foundry 130 percent and accepts integer overrides >= 100', () => {
      expect(DEFAULT_GAS_ESTIMATE_MULTIPLIER).toBe(130n);
      expect(resolveGasEstimateMultiplier({})).toBe(130n);
      expect(resolveGasEstimateMultiplier({ FORGE_GAS_ESTIMATE_MULTIPLIER: '150' })).toBe(150n);
      expect(resolveGasEstimateMultiplier({ FORGE_GAS_ESTIMATE_MULTIPLIER: '100' })).toBe(100n);
    });

    it('rejects multipliers below 100 or non-integer values', () => {
      for (const bad of ['99', '0', '130.5', 'abc']) {
        expect(() => resolveGasEstimateMultiplier({ FORGE_GAS_ESTIMATE_MULTIPLIER: bad })).toThrow(
          /FORGE_GAS_ESTIMATE_MULTIPLIER must be an integer percentage >= 100/,
        );
      }
    });
  });

  describe('computeAutomationGasPlan', () => {
    it('gives full 2x gas-price headroom on Reactive Mainnet with 5 REACT budget', () => {
      const plan = computeAutomationGasPlan({
        chain: MAINNET_CHAINS.reactive,
        estimatedGas: LIVE_MAINNET_ESTIMATED_GAS,
        suggestedGasPrice: parseGwei('100'),
        balance: parseEther('5'),
        feeCap: REACTIVE_MAINNET_DEFAULT_FEE_CAP,
      });

      expect(plan.broadcastGas).toBe(11_106_322n);
      expect(plan.gasPrice).toBe(parseGwei('200'));
      expect(plan.gasPriceArg).toBe('200gwei');
      expect(plan.requiredBalance).toBe(2_221_264_400_000_000_000n);
    });

    it('succeeds above the old 111 gwei Lasna cap when suggested price is 150 gwei', () => {
      const plan = computeAutomationGasPlan({
        chain: MAINNET_CHAINS.reactive,
        estimatedGas: LIVE_MAINNET_ESTIMATED_GAS,
        suggestedGasPrice: parseGwei('150'),
        balance: parseEther('5'),
        feeCap: REACTIVE_MAINNET_DEFAULT_FEE_CAP,
      });

      expect(plan.gasPrice).toBe(parseGwei('300'));
      expect(plan.gasPriceArg).toBe('300gwei');
      expect(plan.requiredBalance).toBe(3_331_896_600_000_000_000n);
    });

    it('rejects an underfunded wallet that would fail Foundry 1.3x broadcast', () => {
      expect(() =>
        computeAutomationGasPlan({
          chain: MAINNET_CHAINS.reactive,
          estimatedGas: LIVE_MAINNET_ESTIMATED_GAS,
          suggestedGasPrice: parseGwei('100'),
          balance: parseEther('1.00'),
          feeCap: REACTIVE_MAINNET_DEFAULT_FEE_CAP,
        }),
      ).toThrow(/deployer needs more REACT on Reactive Mainnet/i);
    });

    it('scales gas price down cleanly for a tightly funded wallet (1.50 REACT)', () => {
      const plan = computeAutomationGasPlan({
        chain: MAINNET_CHAINS.reactive,
        estimatedGas: LIVE_MAINNET_ESTIMATED_GAS,
        suggestedGasPrice: parseGwei('100'),
        balance: parseEther('1.50'),
        feeCap: REACTIVE_MAINNET_DEFAULT_FEE_CAP,
      });

      expect(plan.gasPrice).toBe(parseGwei('135'));
      expect(plan.requiredBalance).toBe(1_499_353_470_000_000_000n);
      expect(plan.requiredBalance <= parseEther('1.50')).toBe(true);
    });

    it('fails with a fee-cap hint when wallet balance is ample but cap is too low', () => {
      expect(() =>
        computeAutomationGasPlan({
          chain: MAINNET_CHAINS.reactive,
          estimatedGas: LIVE_MAINNET_ESTIMATED_GAS,
          suggestedGasPrice: parseGwei('350'),
          balance: parseEther('10'),
          feeCap: parseEther('3.5'),
        }),
      ).toThrow(/Raise REACTIVE_MAINNET_FEE_CAP to override/);
    });

    it('preserves Reactive Lasna testnet deployment behavior with 1.3x broadcast gas', () => {
      const plan = computeAutomationGasPlan({
        chain: TESTNET_CHAINS.lasna,
        estimatedGas: LIVE_MAINNET_ESTIMATED_GAS,
        suggestedGasPrice: parseGwei('1'),
        balance: parseEther('0.95'),
        feeCap: LASNA_DEFAULT_FEE_CAP,
      });

      expect(plan.broadcastGas).toBe(11_106_322n);
      expect(plan.gasPrice).toBe(parseGwei('2'));
      expect(plan.gasPriceArg).toBe('2gwei');
    });

    it('handles sub-gwei suggested gas prices without truncating to zero', () => {
      const plan = computeAutomationGasPlan({
        chain: TESTNET_CHAINS.lasna,
        estimatedGas: 1_000_000n,
        suggestedGasPrice: 50_000_000n,
        balance: parseEther('0.95'),
        feeCap: LASNA_DEFAULT_FEE_CAP,
      });

      expect(plan.gasPrice).toBe(100_000_000n);
      expect(plan.gasPriceArg).toBe('100000000');
    });

    it('applies custom Foundry gas estimate multipliers', () => {
      const plan = computeAutomationGasPlan({
        chain: MAINNET_CHAINS.reactive,
        estimatedGas: LIVE_MAINNET_ESTIMATED_GAS,
        suggestedGasPrice: parseGwei('100'),
        balance: parseEther('5'),
        feeCap: REACTIVE_MAINNET_DEFAULT_FEE_CAP,
        gasEstimateMultiplier: 150n,
      });

      expect(plan.broadcastGas).toBe(12_814_986n);
      expect(plan.requiredBalance).toBe(2_562_997_200_000_000_000n);
    });
  });
});
