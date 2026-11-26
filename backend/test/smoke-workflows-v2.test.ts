import { zeroHash, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_MAX_ACTIVE,
  LOG_BLOCK_CHUNK_SIZE,
  SMOKE_WORKFLOW_TITLES,
  assertSmokeCliArgs,
  fundsRpcEnvName,
  getLogsChunked,
  mergeSmokeEvidence,
  nextLogScanCursor,
  resolveSmokeSignerKey,
  resolveSmokeTargetChains,
  retireStaleWorkflowsForChain,
  retireWorkflow,
  runWithWorkflowCleanup,
  type AgentEntryState,
  type ChainSmokeEvidence,
  type RetireWorkflowDeps,
  type SmokeEvidence,
  type VaultAuthorizationState,
} from '../../scripts/smoke-workflows-v2.js';

const KEY_A = `0x${'11'.repeat(32)}` as const;
const KEY_B = `0x${'22'.repeat(32)}` as const;
const KEY_B_BARE = '22'.repeat(32);

const WF_1 = `0x${'aa'.repeat(32)}` as Hex;
const WF_2 = `0x${'bb'.repeat(32)}` as Hex;
const WF_3 = `0x${'cc'.repeat(32)}` as Hex;
const WF_4 = `0x${'dd'.repeat(32)}` as Hex;
const TX_VAULT_1 = `0x${'1a'.repeat(32)}` as Hex;
const TX_AGENT_1 = `0x${'2a'.repeat(32)}` as Hex;
const TX_VAULT_2 = `0x${'1b'.repeat(32)}` as Hex;
const TX_AGENT_2 = `0x${'2b'.repeat(32)}` as Hex;

const ADDR_FACTORY = '0x1111111111111111111111111111111111111111' as Address;
const ADDR_FACTORY_OTHER = '0x2222222222222222222222222222222222222222' as Address;
const ADDR_AGENT = '0x3333333333333333333333333333333333333333' as Address;
const ADDR_VAULT_UNI = '0x4444444444444444444444444444444444444444' as Address;
const ADDR_VAULT_BASE = '0x5555555555555555555555555555555555555555' as Address;
const ADDR_RECIPIENT = '0x6666666666666666666666666666666666666666' as Address;

function sampleChainEvidence(
  chainId: 130 | 8453,
  chainName: string,
  vault: Address,
): ChainSmokeEvidence {
  return {
    chainId,
    chainName,
    vaultFactory: ADDR_FACTORY,
    deploymentCommit: 'abc1234',
    vault,
    retiredStaleWorkflows: [],
    sweep: {
      title: SMOKE_WORKFLOW_TITLES[0],
      workflow: WF_1,
      programHash: `0x${'01'.repeat(32)}` as Hex,
      authorizationTransaction: TX_VAULT_1,
      weeklyUsdcLimitBaseUnits: '1000000',
      runs: [],
      cleanup: {
        vaultRevokeTransaction: TX_VAULT_1,
        agentDisableTransaction: TX_AGENT_1,
      },
    },
    schedule: {
      title: SMOKE_WORKFLOW_TITLES[1],
      workflow: WF_2,
      programHash: `0x${'02'.repeat(32)}` as Hex,
      authorizationTransaction: TX_VAULT_2,
      run: {
        spentUsdcBaseUnits: '200000',
        runId: `0x${'03'.repeat(32)}` as Hex,
        path: 0,
        status: 'confirmed',
        originTransaction: `0x${'04'.repeat(32)}` as Hex,
        lasnaTransaction: `0x${'05'.repeat(32)}` as Hex,
        destinationTransaction: `0x${'06'.repeat(32)}` as Hex,
      },
      cleanup: {
        vaultRevokeTransaction: TX_VAULT_2,
        agentDisableTransaction: TX_AGENT_2,
      },
    },
  };
}

describe('smoke-workflows-v2', () => {
  describe('resolveSmokeSignerKey', () => {
    it('uses DEPLOYER_PRIVATE_KEY on testnet and fails when unset', () => {
      expect(resolveSmokeSignerKey(false, { DEPLOYER_PRIVATE_KEY: KEY_A })).toBe(KEY_A);
      expect(resolveSmokeSignerKey(false, { DEPLOYER_PRIVATE_KEY: KEY_B_BARE })).toBe(KEY_B);
      expect(() => resolveSmokeSignerKey(false, {})).toThrow(
        /Set DEPLOYER_PRIVATE_KEY before running the live smoke/,
      );
    });

    it('requires MAINNET_DEPLOYER_PRIVATE_KEY on mainnet even if DEPLOYER_PRIVATE_KEY is set', () => {
      expect(() => resolveSmokeSignerKey(true, { DEPLOYER_PRIVATE_KEY: KEY_A })).toThrow(
        /Set a dedicated MAINNET_DEPLOYER_PRIVATE_KEY/,
      );
    });

    it('blocks reusing DEPLOYER_PRIVATE_KEY or SPONSOR_PRIVATE_KEY on mainnet', () => {
      const addressA = privateKeyToAccount(KEY_A).address;
      expect(() =>
        resolveSmokeSignerKey(true, {
          MAINNET_DEPLOYER_PRIVATE_KEY: KEY_A,
          DEPLOYER_PRIVATE_KEY: KEY_A.slice(2),
        }),
      ).toThrow(
        new RegExp(`must not share an address with DEPLOYER_PRIVATE_KEY \\(${addressA}\\)`),
      );

      expect(() =>
        resolveSmokeSignerKey(true, {
          MAINNET_DEPLOYER_PRIVATE_KEY: KEY_B_BARE,
          SPONSOR_PRIVATE_KEY: KEY_B,
        }),
      ).toThrow(/must not share an address with SPONSOR_PRIVATE_KEY/);
    });

    it('accepts a distinct MAINNET_DEPLOYER_PRIVATE_KEY on mainnet', () => {
      expect(
        resolveSmokeSignerKey(true, {
          MAINNET_DEPLOYER_PRIVATE_KEY: KEY_B_BARE,
          DEPLOYER_PRIVATE_KEY: KEY_A,
        }),
      ).toBe(KEY_B);
    });
  });

  describe('fundsRpcEnvName', () => {
    it('maps all configured testnet and mainnet funds chains to their RPC env names', () => {
      expect(fundsRpcEnvName(130)).toBe('UNICHAIN_MAINNET_RPC_URL');
      expect(fundsRpcEnvName(8453)).toBe('BASE_MAINNET_RPC_URL');
      expect(fundsRpcEnvName(1301)).toBe('UNICHAIN_RPC_URL');
      expect(fundsRpcEnvName(84532)).toBe('BASE_SEPOLIA_RPC_URL');
    });
  });

  describe('assertSmokeCliArgs', () => {
    it('accepts supported flags and rejects unknown flags or typos', () => {
      expect(() =>
        assertSmokeCliArgs(['--mainnet', '--confirm-mainnet', '--chain', 'base']),
      ).not.toThrow();
      expect(() => assertSmokeCliArgs(['--chains=unichain,8453'])).not.toThrow();
      expect(() => assertSmokeCliArgs(['--chian', 'base'])).toThrow(/Unknown argument "--chian"/);
      expect(() => assertSmokeCliArgs(['--confirm-mainet'])).toThrow(
        /Unknown argument "--confirm-mainet"/,
      );
      expect(() => assertSmokeCliArgs(['--chain', '--mainnet'])).toThrow(
        /Missing value for --chain/,
      );
    });
  });

  describe('resolveSmokeTargetChains', () => {
    it('defaults to both Unichain and Base chains for the active mode', () => {
      expect(resolveSmokeTargetChains(true, [])).toEqual([130, 8453]);
      expect(resolveSmokeTargetChains(false, [])).toEqual([1301, 84532]);
    });

    it('parses named targets, numeric chain IDs, comma-separated lists, and deduplicates', () => {
      expect(resolveSmokeTargetChains(true, ['--mainnet', '--chain', 'base'])).toEqual([8453]);
      expect(resolveSmokeTargetChains(true, ['--chain=unichain'])).toEqual([130]);
      expect(resolveSmokeTargetChains(true, ['--chains', '8453,130'])).toEqual([8453, 130]);
      expect(resolveSmokeTargetChains(true, ['--chain', 'all', '--chain', 'base'])).toEqual([
        130, 8453,
      ]);
      expect(
        resolveSmokeTargetChains(false, ['--chain', 'base', '--chain=1301', '--chain', '84532']),
      ).toEqual([84532, 1301]);
    });

    it('rejects cross-mode chain IDs, unknown targets, and missing flag values', () => {
      expect(() => resolveSmokeTargetChains(false, ['--chain', '8453'])).toThrow(
        /Chain 8453 is not a testnet funds chain/,
      );
      expect(() => resolveSmokeTargetChains(false, ['--chain', '130'])).toThrow(
        /Chain 130 is not a testnet funds chain/,
      );
      expect(() => resolveSmokeTargetChains(true, ['--chain', '84532'])).toThrow(
        /Chain 84532 is not a mainnet funds chain/,
      );
      expect(() => resolveSmokeTargetChains(true, ['--chain', '1301'])).toThrow(
        /Chain 1301 is not a mainnet funds chain/,
      );
      expect(() => resolveSmokeTargetChains(true, ['--chain', 'arbitrum'])).toThrow(
        /Invalid --chain target "arbitrum"/,
      );
      for (const badArgs of [['--chain'], ['--chain', '--mainnet'], ['--chain='], ['--chains=']]) {
        expect(() => resolveSmokeTargetChains(true, badArgs)).toThrow(/Missing value for --chain/);
      }
    });
  });

  describe('retireWorkflow', () => {
    it('revokes on Vault and disables on Agent using each contract epoch', async () => {
      const revokeOnVault = vi.fn(async () => TX_VAULT_1);
      const disableOnAgent = vi.fn(async () => TX_AGENT_1);
      const deps: RetireWorkflowDeps = {
        readVaultAuthorization: async () => ({ epoch: 2n, active: true }),
        readAgentEntry: async () => ({ epoch: 5n, trigger: 3, chain: 8453 }),
        revokeOnVault,
        disableOnAgent,
      };

      const result = await retireWorkflow(WF_1, deps);

      expect(revokeOnVault).toHaveBeenCalledWith(WF_1, 2n);
      expect(disableOnAgent).toHaveBeenCalledWith(WF_1, 5n);
      expect(result).toEqual({
        workflowId: WF_1,
        vaultRevokeTransaction: TX_VAULT_1,
        agentDisableTransaction: TX_AGENT_1,
      });
    });

    it('skips inactive sides without issuing unnecessary transactions', async () => {
      const revokeOnVault = vi.fn(async () => TX_VAULT_1);
      const disableOnAgent = vi.fn(async () => TX_AGENT_1);

      const agentOnly = await retireWorkflow(WF_1, {
        readVaultAuthorization: async () => ({ epoch: 1n, active: false }),
        readAgentEntry: async () => ({ epoch: 1n, trigger: 1, chain: 130 }),
        revokeOnVault,
        disableOnAgent,
      });
      expect(revokeOnVault).not.toHaveBeenCalled();
      expect(disableOnAgent).toHaveBeenCalledWith(WF_1, 1n);
      expect(agentOnly).toEqual({
        workflowId: WF_1,
        vaultRevokeTransaction: null,
        agentDisableTransaction: TX_AGENT_1,
      });

      revokeOnVault.mockClear();
      disableOnAgent.mockClear();

      const vaultOnly = await retireWorkflow(WF_2, {
        readVaultAuthorization: async () => ({ epoch: 3n, active: true }),
        readAgentEntry: async () => ({ epoch: 3n, trigger: 0, chain: 130 }),
        revokeOnVault,
        disableOnAgent,
      });
      expect(revokeOnVault).toHaveBeenCalledWith(WF_2, 3n);
      expect(disableOnAgent).not.toHaveBeenCalled();
      expect(vaultOnly).toEqual({
        workflowId: WF_2,
        vaultRevokeTransaction: TX_VAULT_1,
        agentDisableTransaction: null,
      });

      revokeOnVault.mockClear();
      disableOnAgent.mockClear();

      const neither = await retireWorkflow(WF_3, {
        readVaultAuthorization: async () => ({ epoch: 0n, active: false }),
        readAgentEntry: async () => ({ epoch: 0n, trigger: 0, chain: 0 }),
        revokeOnVault,
        disableOnAgent,
      });
      expect(revokeOnVault).not.toHaveBeenCalled();
      expect(disableOnAgent).not.toHaveBeenCalled();
      expect(neither).toEqual({
        workflowId: WF_3,
        vaultRevokeTransaction: null,
        agentDisableTransaction: null,
      });
    });

    it('still disables on Agent when Vault read or revoke fails, and reports partial tx hashes', async () => {
      const disableOnAgent = vi.fn(async () => TX_AGENT_1);
      await expect(
        retireWorkflow(WF_1, {
          readVaultAuthorization: async () => ({ epoch: 1n, active: true }),
          readAgentEntry: async () => ({ epoch: 1n, trigger: 3, chain: 130 }),
          revokeOnVault: async () => {
            throw new Error('vault rpc timeout');
          },
          disableOnAgent,
        }),
      ).rejects.toThrow(
        new RegExp(`agentDisable=${TX_AGENT_1}.*vault revoke failed: vault rpc timeout`),
      );
      expect(disableOnAgent).toHaveBeenCalledWith(WF_1, 1n);

      disableOnAgent.mockClear();
      await expect(
        retireWorkflow(WF_1, {
          readVaultAuthorization: async () => {
            throw new Error('vault read error');
          },
          readAgentEntry: async () => ({ epoch: 4n, trigger: 1, chain: 8453 }),
          revokeOnVault: async () => TX_VAULT_1,
          disableOnAgent,
        }),
      ).rejects.toThrow(/vault authorization read failed: vault read error/);
      expect(disableOnAgent).toHaveBeenCalledWith(WF_1, 4n);
    });

    it('still revokes on Vault when Agent disable fails', async () => {
      const revokeOnVault = vi.fn(async () => TX_VAULT_1);
      await expect(
        retireWorkflow(WF_1, {
          readVaultAuthorization: async () => ({ epoch: 2n, active: true }),
          readAgentEntry: async () => ({ epoch: 2n, trigger: 1, chain: 8453 }),
          revokeOnVault,
          disableOnAgent: async () => {
            throw new Error('reactive out of gas');
          },
        }),
      ).rejects.toThrow(
        new RegExp(`vaultRevoke=${TX_VAULT_1}.*agent disable failed: reactive out of gas`),
      );
      expect(revokeOnVault).toHaveBeenCalledWith(WF_1, 2n);
    });
  });

  describe('retireStaleWorkflowsForChain', () => {
    it('retires paymentWorkflow and leaked smoke workflows on target chain while preserving other chains and user workflows', async () => {
      const entries = new Map<string, AgentEntryState>([
        [WF_1.toLowerCase(), { epoch: 1n, trigger: 3, chain: 8453 }],
        [WF_2.toLowerCase(), { epoch: 1n, trigger: 1, chain: 8453 }],
        [WF_3.toLowerCase(), { epoch: 1n, trigger: 1, chain: 130 }],
        [WF_4.toLowerCase(), { epoch: 1n, trigger: 1, chain: 8453 }],
      ]);
      const titles = new Map<string, string>([
        [WF_1.toLowerCase(), 'Custom payment rule'],
        [WF_2.toLowerCase(), SMOKE_WORKFLOW_TITLES[1]],
        [WF_3.toLowerCase(), SMOKE_WORKFLOW_TITLES[1]],
        [WF_4.toLowerCase(), 'User DCA'],
      ]);
      const retiredCalls: Hex[] = [];

      const res = await retireStaleWorkflowsForChain({
        fundsChainId: 8453,
        readPaymentWorkflow: async () => WF_1,
        readAgentWorkflowIds: async () => [WF_1, WF_2, WF_3, WF_4],
        readAgentEntry: async (id) => entries.get(id.toLowerCase())!,
        readAgentTitle: async (id) => titles.get(id.toLowerCase())!,
        retire: async (id) => {
          retiredCalls.push(id);
          return {
            workflowId: id,
            vaultRevokeTransaction: TX_VAULT_1,
            agentDisableTransaction: TX_AGENT_1,
          };
        },
      });

      expect(retiredCalls).toEqual([WF_1, WF_2]);
      expect(res.retired).toHaveLength(2);
      expect(res.remainingActiveAgentWorkflows.map((item) => item.workflowId)).toEqual([
        WF_3,
        WF_4,
      ]);
    });

    it('deduplicates when paymentWorkflow is also an active smoke workflow', async () => {
      const retiredCalls: Hex[] = [];
      const res = await retireStaleWorkflowsForChain({
        fundsChainId: 130,
        readPaymentWorkflow: async () => WF_1,
        readAgentWorkflowIds: async () => [WF_1],
        readAgentEntry: async () => ({ epoch: 1n, trigger: 3, chain: 130 }),
        readAgentTitle: async () => SMOKE_WORKFLOW_TITLES[0],
        retire: async (id) => {
          retiredCalls.push(id);
          return {
            workflowId: id,
            vaultRevokeTransaction: TX_VAULT_1,
            agentDisableTransaction: TX_AGENT_1,
          };
        },
      });

      expect(retiredCalls).toEqual([WF_1]);
      expect(res.retired).toHaveLength(1);
      expect(res.remainingActiveAgentWorkflows).toEqual([]);
    });

    it('retires Vault-only orphaned smoke workflows when Agent entry is already disabled', async () => {
      const retiredCalls: Hex[] = [];
      const res = await retireStaleWorkflowsForChain({
        fundsChainId: 8453,
        readPaymentWorkflow: async () => zeroHash,
        readAgentWorkflowIds: async () => [WF_2],
        readAgentEntry: async () => ({ epoch: 1n, trigger: 0, chain: 8453 }),
        readAgentTitle: async () => SMOKE_WORKFLOW_TITLES[1],
        readVaultWorkflowIds: async () => [WF_2, WF_4],
        readVaultAuthorization: async (id) => ({ epoch: 1n, active: id === WF_2 || id === WF_4 }),
        readVaultTitle: async (id) => (id === WF_2 ? SMOKE_WORKFLOW_TITLES[1] : 'User Vault Rule'),
        retire: async (id) => {
          retiredCalls.push(id);
          return {
            workflowId: id,
            vaultRevokeTransaction: TX_VAULT_2,
            agentDisableTransaction: null,
          };
        },
      });

      expect(retiredCalls).toEqual([WF_2]);
      expect(res.retired).toHaveLength(1);
    });

    it('fails fast when fewer than 2 of MAX_ACTIVE Agent slots remain after retiring stale smoke workflows', async () => {
      expect(AGENT_MAX_ACTIVE).toBe(4);
      const nonSmoke = [WF_1, WF_2, WF_3];
      await expect(
        retireStaleWorkflowsForChain({
          fundsChainId: 8453,
          readPaymentWorkflow: async () => zeroHash,
          readAgentWorkflowIds: async () => nonSmoke,
          readAgentEntry: async () => ({ epoch: 1n, trigger: 1, chain: 130 }),
          readAgentTitle: async () => 'User active strategy',
          retire: async (id) => ({
            workflowId: id,
            vaultRevokeTransaction: null,
            agentDisableTransaction: null,
          }),
        }),
      ).rejects.toThrow(/MAX_ACTIVE = 4 active workflows and needs 2 free slots/);
    });
  });

  describe('runWithWorkflowCleanup', () => {
    it('revokes and disables all tracked smoke workflows in reverse order on success', async () => {
      const retired: Hex[] = [];
      const { result, cleanups } = await runWithWorkflowCleanup(
        async (track) => {
          track(WF_1);
          track(WF_2);
          return 'ok';
        },
        async (id) => {
          retired.push(id);
          return {
            workflowId: id,
            vaultRevokeTransaction: id === WF_1 ? TX_VAULT_1 : TX_VAULT_2,
            agentDisableTransaction: id === WF_1 ? TX_AGENT_1 : TX_AGENT_2,
          };
        },
      );

      expect(result).toBe('ok');
      expect(retired).toEqual([WF_2, WF_1]);
      expect(cleanups).toHaveLength(2);
    });

    it('cleans up tracked workflows in finally when verification throws midway', async () => {
      const retired: Hex[] = [];
      await expect(
        runWithWorkflowCleanup(
          async (track) => {
            track(WF_1);
            track(WF_2);
            throw new Error('Scheduled buy was not dispatched');
          },
          async (id) => {
            retired.push(id);
            return {
              workflowId: id,
              vaultRevokeTransaction: TX_VAULT_1,
              agentDisableTransaction: TX_AGENT_1,
            };
          },
        ),
      ).rejects.toThrow('Scheduled buy was not dispatched');

      expect(retired).toEqual([WF_2, WF_1]);
    });

    it('attempts remaining cleanups when one cleanup fails and reports both run and cleanup errors', async () => {
      const retired: Hex[] = [];
      const onCleanupError = vi.fn();

      await expect(
        runWithWorkflowCleanup(
          async (track) => {
            track(WF_1);
            track(WF_2);
            throw new Error('observation failed');
          },
          async (id) => {
            retired.push(id);
            if (id === WF_2) throw new Error('disable reverted');
            return {
              workflowId: id,
              vaultRevokeTransaction: TX_VAULT_1,
              agentDisableTransaction: TX_AGENT_1,
            };
          },
          onCleanupError,
        ),
      ).rejects.toThrow(/observation failed[\s\S]*Cleanup also failed[\s\S]*disable reverted/);

      expect(retired).toEqual([WF_2, WF_1]);
      expect(onCleanupError).toHaveBeenCalledTimes(1);
    });

    it('throws when smoke verification succeeds but cleanup fails', async () => {
      const onCleanupError = vi.fn();
      await expect(
        runWithWorkflowCleanup(
          async (track) => {
            track(WF_1);
            return 42;
          },
          async () => {
            throw new Error('network error');
          },
          onCleanupError,
        ),
      ).rejects.toThrow(/Smoke verification succeeded, but workflow cleanup failed/);
      expect(onCleanupError).toHaveBeenCalledTimes(1);
    });
  });

  describe('mergeSmokeEvidence', () => {
    it('preserves prior chain results when updating a single chain on the same Agent and factory', () => {
      const existing: SmokeEvidence = {
        network: 'mainnet',
        automationChainId: 1597,
        agentFactory: ADDR_FACTORY,
        deploymentCommit: 'abc1234',
        agent: ADDR_AGENT,
        recipient: ADDR_RECIPIENT,
        chains: {
          '130': sampleChainEvidence(130, 'Unichain', ADDR_VAULT_UNI),
        },
      };
      const next: SmokeEvidence = {
        network: 'mainnet',
        automationChainId: 1597,
        agentFactory: ADDR_FACTORY.toLowerCase() as Address,
        deploymentCommit: 'abc1234',
        agent: ADDR_AGENT.toLowerCase() as Address,
        recipient: ADDR_RECIPIENT,
        chains: {
          '8453': sampleChainEvidence(8453, 'Base', ADDR_VAULT_BASE),
        },
      };

      const merged = mergeSmokeEvidence(existing, next);
      expect(Object.keys(merged.chains)).toEqual(['130', '8453']);
      expect(merged.chains['130']?.vault).toBe(ADDR_VAULT_UNI);
      expect(merged.chains['8453']?.vault).toBe(ADDR_VAULT_BASE);
    });

    it('replaces evidence when agentFactory changes or existing format is legacy', () => {
      const next: SmokeEvidence = {
        network: 'mainnet',
        automationChainId: 1597,
        agentFactory: ADDR_FACTORY,
        deploymentCommit: 'abc1234',
        agent: ADDR_AGENT,
        recipient: ADDR_RECIPIENT,
        chains: {
          '8453': sampleChainEvidence(8453, 'Base', ADDR_VAULT_BASE),
        },
      };

      expect(
        mergeSmokeEvidence(
          {
            network: 'mainnet',
            automationChainId: 1597,
            agentFactory: ADDR_FACTORY_OTHER,
            agent: ADDR_AGENT,
            chains: { '130': sampleChainEvidence(130, 'Unichain', ADDR_VAULT_UNI) },
          },
          next,
        ),
      ).toEqual(next);

      expect(mergeSmokeEvidence({ sweep: {}, schedule: {} }, next)).toEqual(next);
      expect(mergeSmokeEvidence(null, next)).toEqual(next);
    });
  });

  describe('getLogsChunked', () => {
    it('chunks ranges above Unichain 1,000-block RPC cap into <=200-block inclusive windows', async () => {
      expect(LOG_BLOCK_CHUNK_SIZE).toBe(200n);
      const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
      const fetchChunk = vi.fn(async (range: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push(range);
        return [`log-${range.fromBlock}-${range.toBlock}`];
      });

      const result = await getLogsChunked(async () => 3499n, fetchChunk, 1000n);

      expect(result.lastScannedBlock).toBe(3499n);
      expect(ranges).toHaveLength(13);
      expect(ranges[0]).toEqual({ fromBlock: 1000n, toBlock: 1199n });
      expect(ranges[11]).toEqual({ fromBlock: 3200n, toBlock: 3399n });
      expect(ranges[12]).toEqual({ fromBlock: 3400n, toBlock: 3499n });
      for (const range of ranges) {
        const span = range.toBlock - range.fromBlock + 1n;
        expect(span).toBeGreaterThan(0n);
        expect(span).toBeLessThanOrEqual(LOG_BLOCK_CHUNK_SIZE);
        expect(span).toBeLessThanOrEqual(1000n);
      }
      expect(result.logs[0]).toBe('log-1000-1199');
      expect(result.logs[result.logs.length - 1]).toBe('log-3400-3499');
    });

    it('handles exact chunk multiples and single-block ranges cleanly', async () => {
      const exactRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
      await getLogsChunked(
        async () => 399n,
        async (range) => {
          exactRanges.push(range);
          return [];
        },
        0n,
      );
      expect(exactRanges).toEqual([
        { fromBlock: 0n, toBlock: 199n },
        { fromBlock: 200n, toBlock: 399n },
      ]);

      const singleRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
      await getLogsChunked(
        async () => 50n,
        async (range) => {
          singleRanges.push(range);
          return ['only'];
        },
        50n,
      );
      expect(singleRanges).toEqual([{ fromBlock: 50n, toBlock: 50n }]);
    });

    it('returns empty without calling fetchChunk when fromBlock is ahead of head', async () => {
      const fetchChunk = vi.fn();
      const result = await getLogsChunked(async () => 100n, fetchChunk, 101n);
      expect(result).toEqual({ logs: [], lastScannedBlock: null });
      expect(fetchChunk).not.toHaveBeenCalled();
    });

    it('rejects non-positive chunk sizes', async () => {
      await expect(
        getLogsChunked(
          async () => 10n,
          async () => [],
          0n,
          0n,
        ),
      ).rejects.toThrow(/at least 1/);
    });
  });

  describe('nextLogScanCursor', () => {
    it('advances cursor with 2-block reorg overlap and clamps to startBlock', () => {
      expect(nextLogScanCursor(1000n, 1000n, null)).toBe(1000n);
      expect(nextLogScanCursor(1000n, 1000n, 1000n)).toBe(1000n);
      expect(nextLogScanCursor(1000n, 1000n, 1001n)).toBe(1000n);
      expect(nextLogScanCursor(1000n, 1000n, 1500n)).toBe(1498n);
      expect(nextLogScanCursor(0n, 0n, 1n)).toBe(0n);
    });
  });
});

// Type-level check that VaultAuthorizationState is exported cleanly.
const _vaultAuthTypeCheck: VaultAuthorizationState = { epoch: 1n, active: true };
void _vaultAuthTypeCheck;
