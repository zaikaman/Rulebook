import { toFunctionSelector } from 'viem';
import { describe, expect, it } from 'vitest';

import { workflowV2FailureReason } from '../../src/workflows/failureReasons.js';

describe('workflow V2 failure reasons', () => {
  it('explains a weekly budget skip with the public reason', () => {
    const reason = workflowV2FailureReason(toFunctionSelector('WeeklyBudgetExceeded()'));
    expect(reason.message).toBe('Run would exceed the weekly spending budget');
    expect(reason.recovery).toBe('limits');
  });

  it('turns a token or swap failure into an actionable balance message', () => {
    const reason = workflowV2FailureReason(toFunctionSelector('Error(string)'));
    expect(reason.message).toBe(
      'A token transfer or swap failed. Check the Vault balances and the market.',
    );
    expect(reason.recovery).toBe('balances');
  });
});
