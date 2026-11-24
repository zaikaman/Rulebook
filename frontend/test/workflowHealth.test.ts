import {
  createWorkflowV2Recipe,
  deriveWorkflowHealth,
  type WorkflowHealthInput,
} from '@rulebook/shared';
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';

const recipient: Address = '0x0000000000000000000000000000000000000001';
const executionThreshold = 100_000_000_000_000n;
const watchingThreshold = 50_000_000_000_000_000n;

function recurringTransfer() {
  return createWorkflowV2Recipe('recurring-transfer', {
    intervalSeconds: '3600',
    sendUsdc: '0.02',
    recipient,
  });
}

function incomeSweep() {
  return createWorkflowV2Recipe('income-sweep', {
    minimumPaymentUsdc: '1',
    sendUsdc: '0.5',
    recipient,
  });
}

function input(overrides: Partial<WorkflowHealthInput> = {}): WorkflowHealthInput {
  return {
    active: true,
    readyToActivate: false,
    closed: false,
    program: recurringTransfer(),
    executionCredit: null,
    watchingCredit: null,
    budget: null,
    lastRun: null,
    ...overrides,
  };
}

describe('workflow health', () => {
  it('names a payment workflow that has not received a payment', () => {
    const health = deriveWorkflowHealth(input({ program: incomeSweep() }));
    expect(health).toMatchObject({
      code: 'waiting-payment',
      label: 'Waiting for a payment',
      tone: 'active',
      attention: false,
    });
  });

  it('watches for the next trigger on a healthy scheduled workflow', () => {
    expect(deriveWorkflowHealth(input())).toMatchObject({
      code: 'watching',
      tone: 'active',
      fix: 'activity',
    });
  });

  it('distinguishes paused workflows from workflows waiting for activation', () => {
    expect(deriveWorkflowHealth(input({ active: false }))).toMatchObject({
      code: 'paused',
      label: 'Paused',
      fix: 'edit',
    });
    expect(deriveWorkflowHealth(input({ active: false, readyToActivate: true }))).toMatchObject({
      code: 'ready',
      label: 'Ready to activate',
      fixLabel: 'Finish activation',
    });
  });

  it('blocks a run on low or unpaid execution credit before any other run state', () => {
    const health = deriveWorkflowHealth(
      input({
        executionCredit: { reserve: 0n, debt: 0n, threshold: executionThreshold },
        lastRun: { status: 'pending', reason: null, reasonCode: null, recovery: null },
      }),
    );
    expect(health).toMatchObject({
      code: 'execution-credit',
      label: 'Blocked by low execution credit',
      tone: 'danger',
      fix: 'execution-credit',
      attention: true,
    });
    expect(health.summary).toContain('empty');

    const debt = deriveWorkflowHealth(
      input({
        executionCredit: { reserve: executionThreshold, debt: 1n, threshold: executionThreshold },
      }),
    );
    expect(debt.summary).toContain('owes');
  });

  it('blocks a workflow whose watching credit is below the warning reserve', () => {
    expect(
      deriveWorkflowHealth(
        input({
          watchingCredit: {
            reserve: watchingThreshold - 1n,
            debt: 0n,
            threshold: watchingThreshold,
          },
        }),
      ),
    ).toMatchObject({
      code: 'watching-credit',
      label: 'Blocked by low watching credit',
      tone: 'paused',
      fix: 'watching-credit',
    });
  });

  it('reports the asset whose weekly budget is used up', () => {
    const health = deriveWorkflowHealth(
      input({
        budget: {
          usdcLimit: 10_000_000n,
          usdcRemaining: 0n,
          wethLimit: 0n,
          wethRemaining: 0n,
          resetsAt: 1_800_000_000n,
        },
      }),
    );
    expect(health).toMatchObject({
      code: 'budget',
      label: 'Budget reached',
      tone: 'paused',
      fix: 'weekly-budget',
    });
    expect(health.summary).toContain('USDC');
    expect(health.summary).toContain('UTC');
  });

  it('does not treat an unlimited weekly budget as reached', () => {
    expect(
      deriveWorkflowHealth(
        input({
          budget: {
            usdcLimit: 0n,
            usdcRemaining: 0n,
            wethLimit: 0n,
            wethRemaining: 0n,
            resetsAt: 0n,
          },
        }),
      ).code,
    ).toBe('watching');
  });

  it('shows a dispatched callback before an older failure', () => {
    expect(
      deriveWorkflowHealth(
        input({
          lastRun: { status: 'pending', reason: null, reasonCode: null, recovery: null },
        }),
      ),
    ).toMatchObject({
      code: 'callback-pending',
      label: 'Callback pending',
      fix: 'run',
      attention: false,
    });
  });

  it('reports a grace-period payout separately from a pending callback', () => {
    const health = deriveWorkflowHealth(
      input({
        lastRun: { status: 'in grace period', reason: null, reasonCode: null, recovery: null },
      }),
    );
    expect(health).toMatchObject({
      code: 'grace-period',
      label: 'Inactivity payout in grace period',
      tone: 'info',
      fix: 'run',
      attention: false,
    });
    expect(health.summary).toContain('24 hours');
  });

  it('keeps a failed run actionable with its recovery target', () => {
    const health = deriveWorkflowHealth(
      input({
        lastRun: {
          status: 'failed',
          reason: 'The wallet or Vault had insufficient tokens.',
          reasonCode: '0x12345678',
          recovery: 'balances',
        },
      }),
    );
    expect(health).toMatchObject({
      code: 'run-failed',
      label: 'Last run failed',
      tone: 'danger',
      fix: 'account',
      fixLabel: 'Open Account & Vault',
      attention: true,
    });
    expect(health.summary).toContain('insufficient tokens');
  });

  it('reports an expired run and a completed one-time workflow', () => {
    expect(
      deriveWorkflowHealth(
        input({
          lastRun: { status: 'expired', reason: null, reasonCode: null, recovery: null },
        }),
      ),
    ).toMatchObject({ code: 'run-expired', label: 'Last run unconfirmed', fix: 'run' });
    expect(deriveWorkflowHealth(input({ closed: true }))).toMatchObject({
      code: 'completed',
      label: 'Completed',
      attention: false,
    });
  });
});
