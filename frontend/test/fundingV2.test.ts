import {
  BASE_SEPOLIA_CHAIN_ID,
  createWorkflowV2Recipe,
  type WorkflowV2Program,
} from '@rulebook/shared';
import { describe, expect, it } from 'vitest';
import { zeroAddress, type Address } from 'viem';

import { workflowFundingIssues, workflowFundingNeeds } from '../src/workflows/fundingV2';

const vault: Address = '0x0000000000000000000000000000000000000001';

const balances = {
  vault,
  stable: 10_000_000n,
  wrapped: 1_000_000_000_000_000_000n,
  walletStable: 100_000_000n,
};

const unlimited = { usdc: 0n, weth: 0n };

function scheduledBuy(): WorkflowV2Program {
  return createWorkflowV2Recipe('scheduled-buy', {
    intervalSeconds: '3600',
    buyUsdc: '0.02',
    slippagePercent: '1',
  });
}

function takeProfit(): WorkflowV2Program {
  return createWorkflowV2Recipe('take-profit', {
    expiresAt: '2000000000',
    sellWeth: '0.1',
    slippagePercent: '1',
    targetPrice: '4000',
  });
}

describe('workflow funding preflight', () => {
  it('requires the largest USDC spend from the Vault', () => {
    expect(workflowFundingNeeds(scheduledBuy())).toEqual({
      maxUsdc: 20_000n,
      maxWeth: 0n,
      vaultUsdc: 20_000n,
      vaultWeth: 0n,
      walletUsdc: 0n,
    });
  });

  it('requires WETH for a sale and leaves USDC at zero', () => {
    expect(workflowFundingNeeds(takeProfit())).toEqual({
      maxUsdc: 0n,
      maxWeth: 100_000_000_000_000_000n,
      vaultUsdc: 0n,
      vaultWeth: 100_000_000_000_000_000n,
      walletUsdc: 0n,
    });
  });

  it('does not require Vault USDC for a payment-triggered sweep', () => {
    const program = createWorkflowV2Recipe('income-sweep', {
      minimumPaymentUsdc: '1',
      sendUsdc: '0.5',
      recipient: vault,
    });
    expect(workflowFundingNeeds(program)).toMatchObject({
      maxUsdc: 500_000n,
      vaultUsdc: 0n,
    });
  });

  it('checks the wallet and not the Vault for a refill', () => {
    const program = createWorkflowV2Recipe('balance-refill', {
      intervalSeconds: '3600',
      floorUsdc: '1',
      refillUsdc: '5',
    });
    expect(workflowFundingNeeds(program)).toMatchObject({
      maxUsdc: 0n,
      vaultUsdc: 0n,
      walletUsdc: 5_000_000n,
    });
    expect(
      workflowFundingIssues(program, unlimited, { ...balances, walletStable: 1_000_000n }).map(
        (issue) => issue.code,
      ),
    ).toEqual(['wallet-usdc']);
  });

  it('blocks an empty Vault for a scheduled buy', () => {
    const issues = workflowFundingIssues(scheduledBuy(), unlimited, {
      ...balances,
      stable: 0n,
    });
    expect(issues.map((issue) => issue.code)).toEqual(['vault-usdc']);
    expect(issues[0]?.message).toContain('0 USDC');
    expect(issues[0]?.message).toContain('0.02 USDC');
  });

  it('blocks a weekly budget below the largest run', () => {
    const issues = workflowFundingIssues(scheduledBuy(), { usdc: 10_000n, weth: 0n }, balances);
    expect(issues.map((issue) => issue.code)).toEqual(['budget-usdc']);
  });

  it('blocks an empty WETH balance for a sale', () => {
    const issues = workflowFundingIssues(takeProfit(), unlimited, {
      ...balances,
      wrapped: 0n,
    });
    expect(issues.map((issue) => issue.code)).toEqual(['vault-weth']);
  });

  it('blocks a weekly WETH budget below the sale size', () => {
    const issues = workflowFundingIssues(
      takeProfit(),
      { usdc: 0n, weth: 10n ** 17n - 1n },
      balances,
    );
    expect(issues.map((issue) => issue.code)).toEqual(['budget-weth']);
  });

  it('blocks a missing Vault before checking token balances', () => {
    const issues = workflowFundingIssues(scheduledBuy(), unlimited, {
      ...balances,
      vault: zeroAddress,
      stable: 0n,
    });
    expect(issues.map((issue) => issue.code)).toEqual(['vault-missing']);
  });

  it('passes when balances and limits cover the largest run', () => {
    expect(workflowFundingIssues(scheduledBuy(), unlimited, balances)).toEqual([]);
    expect(workflowFundingIssues(takeProfit(), unlimited, balances)).toEqual([]);
  });

  it('validates funding for workflows targeting Base Sepolia', () => {
    const baseBuy = createWorkflowV2Recipe(
      'scheduled-buy',
      { intervalSeconds: '3600', buyUsdc: '0.02', slippagePercent: '1' },
      { chain: BASE_SEPOLIA_CHAIN_ID },
    );
    expect(workflowFundingIssues(baseBuy, unlimited, balances)).toEqual([]);
    expect(
      workflowFundingIssues(baseBuy, unlimited, { ...balances, stable: 0n }).map((i) => i.code),
    ).toEqual(['vault-usdc']);
  });
});
