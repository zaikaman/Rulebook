import {
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  createWorkflowV2Recipe,
  encodeWorkflowV2,
} from '@rulebook/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zeroAddress, zeroHash, type Hex } from 'viem';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const UNICHAIN_VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const WORKFLOW_ID = `0x${'44'.repeat(32)}` as Hex;

const sampleProgram = createWorkflowV2Recipe(
  'recurring-transfer',
  {
    intervalSeconds: '3600',
    sendUsdc: '1',
    recipient: '0xdddddddddddddddddddddddddddddddddddddddd',
  },
  { chain: UNICHAIN_SEPOLIA_CHAIN_ID },
);
const encodedProgram = encodeWorkflowV2(sampleProgram);

const { mockPublicClientFor } = vi.hoisted(() => ({
  mockPublicClientFor: vi.fn(),
}));

vi.mock('../src/lib/wagmi.js', () => ({
  publicClientFor: mockPublicClientFor,
}));

vi.mock('../src/lib/contracts.js', () => {
  const agentFactory = '0x1111111111111111111111111111111111111111' as const;
  const unichainFactory = '0x2222222222222222222222222222222222222222' as const;
  const baseFactory = '0x3333333333333333333333333333333333333333' as const;
  const deployment = {
    mode: 'testnet' as const,
    automationChainId: 5_318_007 as const,
    automationFactory: agentFactory,
    unichain: { chainId: 1301 as const, factory: unichainFactory, startBlock: 1 },
    base: { chainId: 84532 as const, factory: baseFactory, startBlock: 1 },
  };
  return {
    configuredFundsChainsFor: () => [1301, 84532],
    parseWorkflowV2TestnetDeployment: () => ({
      lasna: { factory: agentFactory, startBlock: 1 },
      unichain: { factory: unichainFactory, startBlock: 1 },
      base: { factory: baseFactory, startBlock: 1 },
    }),
    resolveWorkflowV2Deployment: () => deployment,
  };
});

import { readWorkflowV2, readWorkflowsV2 } from '../src/workflows/chainV2.js';

function makeClients({ baseFails }: { baseFails: boolean }) {
  const lasnaClient = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'agentOf':
          return AGENT;
        case 'entries':
          return [WORKFLOW_ID, 1n, 0n, 0n, 1, UNICHAIN_SEPOLIA_CHAIN_ID, 0n, 0n] as const;
        case 'titles':
          return 'Unichain recurring';
        case 'programs':
          return encodedProgram;
        default:
          throw new Error(`Unexpected Lasna call: ${functionName}`);
      }
    }),
  };
  const unichainClient = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'vaultOf':
          return UNICHAIN_VAULT;
        case 'authorizations':
          return [WORKFLOW_ID, 1n, zeroHash, true] as const;
        case 'workflowMemory':
          return [0n, 0n, 0n, 0n, 0n, 0n, 0n, false] as const;
        case 'weeklyBudget':
          return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
        default:
          throw new Error(`Unexpected Unichain call: ${functionName}`);
      }
    }),
  };
  const baseClient = {
    readContract: vi.fn(async () => {
      if (baseFails) throw new Error('Base Sepolia RPC timeout');
      return zeroAddress;
    }),
  };
  mockPublicClientFor.mockImplementation((chainId: number) => {
    if (chainId === LASNA_CHAIN_ID) return lasnaClient;
    if (chainId === UNICHAIN_SEPOLIA_CHAIN_ID) return unichainClient;
    if (chainId === BASE_SEPOLIA_CHAIN_ID) return baseClient;
    throw new Error(`Unexpected chainId: ${chainId}`);
  });
}

describe('chainV2 per-chain RPC error isolation', () => {
  beforeEach(() => {
    mockPublicClientFor.mockReset();
  });

  it('returns Unichain workflows and lists Base Sepolia in failedChains when Base RPC fails', async () => {
    makeClients({ baseFails: true });
    const result = await readWorkflowsV2(OWNER, 'testnet', [
      { chain: UNICHAIN_SEPOLIA_CHAIN_ID, id: WORKFLOW_ID },
      { chain: BASE_SEPOLIA_CHAIN_ID, id: WORKFLOW_ID },
    ]);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0]?.chain).toBe(UNICHAIN_SEPOLIA_CHAIN_ID);
    expect(result.workflows[0]?.title).toBe('Unichain recurring');
    expect(result.failedChains).toEqual([BASE_SEPOLIA_CHAIN_ID]);
  });

  it('loads a Unichain workflow detail in readWorkflowV2 even when Base RPC fails', async () => {
    makeClients({ baseFails: true });
    const detail = await readWorkflowV2(OWNER, WORKFLOW_ID, 'testnet');
    expect(detail.chain).toBe(UNICHAIN_SEPOLIA_CHAIN_ID);
    expect(detail.title).toBe('Unichain recurring');
    expect(detail.eligibleAt).toBe(0n);
  });
});
