import { toFunctionSelector } from 'viem';
import { describe, expect, it } from 'vitest';

import { workflowV2FailureReason } from '../../src/workflows/failureReasons.js';

describe('workflow V2 failure reasons', () => {
  it('names a Vault shortfall and points at the balances', () => {
    expect(
      workflowV2FailureReason(
        toFunctionSelector('InsufficientVaultBalance(address,uint256,uint256)'),
      ),
    ).toEqual({
      message: 'The Vault did not hold enough of the asset this run needed.',
      recovery: 'balances',
    });
  });

  it('keeps the generic token failure for a string revert', () => {
    expect(workflowV2FailureReason(toFunctionSelector('Error(string)'))).toMatchObject({
      recovery: 'balances',
    });
  });

  it('maps oracle and slippage protection errors to clear explanations', () => {
    expect(workflowV2FailureReason(toFunctionSelector('OracleUnavailable()'))).toEqual({
      message: 'The Chainlink price oracle is unavailable or stale.',
    });
    expect(workflowV2FailureReason(toFunctionSelector('SequencerUnavailable()'))).toEqual({
      message: 'The L2 sequencer is down or still in its recovery grace period.',
    });
    expect(
      workflowV2FailureReason(toFunctionSelector('OraclePriceDeviation(uint256,uint256)')),
    ).toEqual({
      message: 'The origin pool price diverged too far from the settlement oracle price.',
    });
    expect(
      workflowV2FailureReason(toFunctionSelector('SlippageExceeded(uint256,uint256)')),
    ).toEqual({
      message: 'The swap quote was worse than the oracle-protected slippage floor.',
    });
  });

  it('falls back to the contract error message', () => {
    expect(workflowV2FailureReason('0x12345678')).toEqual({
      message: 'Settlement returned a contract error.',
    });
  });
});
