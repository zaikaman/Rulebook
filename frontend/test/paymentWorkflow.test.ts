// @vitest-environment node

import { BASE_SEPOLIA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { zeroAddress, zeroHash, type Address, type Hex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readContract = vi.fn();
const baseReadContract = vi.fn();

const lasnaPublicClient = { readContract: vi.fn() };
const unichainPublicClient = { readContract };
const basePublicClient = { readContract: baseReadContract };

vi.mock('@/lib/wagmi', () => ({
  lasnaPublicClient,
  unichainPublicClient,
  basePublicClient,
  publicClientFor: (chainId: number) =>
    chainId === BASE_SEPOLIA_CHAIN_ID ? basePublicClient : unichainPublicClient,
}));

vi.stubEnv(
  'VITE_WORKFLOW_V2_DEPLOYMENT',
  JSON.stringify({
    lasna: { factory: '0x0000000000000000000000000000000000000011', startBlock: 1 },
    unichain: { factory: '0x0000000000000000000000000000000000000022', startBlock: 1 },
    base: { factory: '0x0000000000000000000000000000000000000033', startBlock: 1 },
  }),
);

const { paymentWorkflowConflictMessage, readPaymentWorkflow } =
  await import('../src/workflows/chainV2.js');

const owner: Address = '0x00000000000000000000000000000000000000a1';
const vault: Address = '0x00000000000000000000000000000000000000b2';
const workflowId: Hex = `0x${'ab'.repeat(32)}`;

describe('readPaymentWorkflow', () => {
  beforeEach(() => {
    readContract.mockReset();
    baseReadContract.mockReset();
  });

  it('returns null when the wallet has no Vault', async () => {
    readContract.mockResolvedValueOnce(zeroAddress);
    await expect(readPaymentWorkflow(owner, UNICHAIN_SEPOLIA_CHAIN_ID)).resolves.toBeNull();
    expect(readContract).toHaveBeenCalledTimes(1);
  });

  it('returns null when the Vault has no active payment workflow', async () => {
    readContract.mockResolvedValueOnce(vault).mockResolvedValueOnce(zeroHash);
    await expect(readPaymentWorkflow(owner, UNICHAIN_SEPOLIA_CHAIN_ID)).resolves.toBeNull();
  });

  it('returns the active payment workflow id and title when set', async () => {
    readContract
      .mockResolvedValueOnce(vault)
      .mockResolvedValueOnce(workflowId)
      .mockResolvedValueOnce('Income sweep');
    await expect(readPaymentWorkflow(owner, UNICHAIN_SEPOLIA_CHAIN_ID)).resolves.toEqual({
      id: workflowId,
      title: 'Income sweep',
    });
  });

  it('formats a clear conflict message with or without a title', () => {
    expect(paymentWorkflowConflictMessage('Income sweep')).toBe(
      'This Vault already has an active Vault receives USDC workflow (Income sweep). Pause or complete it before activating another.',
    );
    expect(paymentWorkflowConflictMessage()).toBe(
      'This Vault already has an active Vault receives USDC workflow. Pause or complete it before activating another.',
    );
  });

  it('reads active payment workflows on Base Sepolia using the Base public client', async () => {
    baseReadContract
      .mockResolvedValueOnce(vault)
      .mockResolvedValueOnce(workflowId)
      .mockResolvedValueOnce('Base sweep');
    await expect(readPaymentWorkflow(owner, BASE_SEPOLIA_CHAIN_ID)).resolves.toEqual({
      id: workflowId,
      title: 'Base sweep',
    });
    expect(readContract).not.toHaveBeenCalled();
  });
});
