import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { keccak256, parseEther, parseGwei } from 'viem';

import {
  DEFAULT_GAS_ESTIMATE_MULTIPLIER,
  LASNA_DEFAULT_FEE_CAP,
  MAINNET_CHAINS,
  REACTIVE_MAINNET_DEFAULT_FEE_CAP,
  TESTNET_CHAINS,
  computeAutomationGasPlan,
  resolveFeeCap,
  resolveGasEstimateMultiplier,
  verifyDeploymentRecord,
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

const tempDirs = [];

async function makeTempRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'rulebook-deploy-v2-'));
  tempDirs.push(dir);
  await mkdir(join(dir, 'contracts', 'out', 'WorkflowAgentFactoryV2.sol'), { recursive: true });
  await mkdir(join(dir, 'contracts', 'out', 'WorkflowVaultFactoryV2.sol'), { recursive: true });
  await mkdir(join(dir, 'deployments'), { recursive: true });
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('verifyDeploymentRecord', () => {
  it('passes offline with --allow-contract-drift and warns on creationInputHash mismatch', async () => {
    const rootDir = await makeTempRoot();
    const recordPath = join(rootDir, 'deployments', 'workflows-v2.json');
    await writeFile(
      join(
        rootDir,
        'contracts',
        'out',
        'WorkflowAgentFactoryV2.sol',
        'WorkflowAgentFactoryV2.json',
      ),
      JSON.stringify({ bytecode: { object: '0x60016000' } }),
    );
    await writeFile(
      join(
        rootDir,
        'contracts',
        'out',
        'WorkflowVaultFactoryV2.sol',
        'WorkflowVaultFactoryV2.json',
      ),
      JSON.stringify({ bytecode: { object: '0x60026000' } }),
    );
    await writeFile(
      recordPath,
      JSON.stringify([
        {
          name: 'Reactive Lasna',
          chainId: TESTNET_CHAINS.lasna.id,
          contract: 'WorkflowAgentFactoryV2',
          address: '0x1111111111111111111111111111111111111111',
          blockNumber: 100,
          source: 'commit',
          commit: 'a'.repeat(40),
          dirty: false,
          creationInputHash: keccak256('0xdead'),
          runtimeCodeHash: keccak256('0xbeef'),
        },
        {
          name: 'Unichain Sepolia',
          chainId: TESTNET_CHAINS.unichain.id,
          contract: 'WorkflowVaultFactoryV2',
          address: '0x2222222222222222222222222222222222222222',
          blockNumber: 200,
          source: 'commit',
          commit: 'a'.repeat(40),
          dirty: false,
          creationInputHash: keccak256('0x60026000'),
          runtimeCodeHash: keccak256('0xbeef'),
        },
      ]),
    );

    const warnings = [];
    const result = await verifyDeploymentRecord({
      recordPath,
      rootDir,
      contractsDir: join(rootDir, 'contracts'),
      offline: true,
      allowContractDrift: true,
      isMainnet: false,
      chains: TESTNET_CHAINS,
      automationKey: 'lasna',
      warn: (msg) => warnings.push(msg),
    });
    expect(result.warnings).toHaveLength(1);
    expect(warnings[0]).toContain('creationInputHash');

    await expect(
      verifyDeploymentRecord({
        recordPath,
        rootDir,
        contractsDir: join(rootDir, 'contracts'),
        offline: true,
        allowContractDrift: false,
        isMainnet: false,
        chains: TESTNET_CHAINS,
        automationKey: 'lasna',
      }),
    ).rejects.toThrow(/creationInputHash/);

    await expect(
      verifyDeploymentRecord({
        recordPath,
        rootDir,
        contractsDir: join(rootDir, 'contracts'),
        offline: true,
        requireArtifacts: true,
        isMainnet: false,
        chains: TESTNET_CHAINS,
        automationKey: 'lasna',
      }),
    ).rejects.toThrow(/proxy deployment evidence/);
  });

  it('rejects dirty or non-commit records even when offline and allowContractDrift are set', async () => {
    const rootDir = await makeTempRoot();
    const recordPath = join(rootDir, 'deployments', 'workflows-v2.json');
    await writeFile(
      recordPath,
      JSON.stringify([
        {
          name: 'Reactive Lasna',
          chainId: TESTNET_CHAINS.lasna.id,
          contract: 'WorkflowAgentFactoryV2',
          address: '0x1111111111111111111111111111111111111111',
          blockNumber: 100,
          source: 'working-tree',
          commit: 'a'.repeat(40),
          dirty: true,
        },
        {
          name: 'Unichain Sepolia',
          chainId: TESTNET_CHAINS.unichain.id,
          contract: 'WorkflowVaultFactoryV2',
          address: '0x2222222222222222222222222222222222222222',
          blockNumber: 200,
          source: 'commit',
          commit: 'a'.repeat(40),
          dirty: false,
        },
      ]),
    );

    await expect(
      verifyDeploymentRecord({
        recordPath,
        rootDir,
        contractsDir: join(rootDir, 'contracts'),
        offline: true,
        allowContractDrift: true,
        isMainnet: false,
        chains: TESTNET_CHAINS,
        automationKey: 'lasna',
      }),
    ).rejects.toThrow(/must record a clean 40-character commit/);
  });

  it('verifies unbundled validator and implementation creationInputHash on both factory types', async () => {
    const rootDir = await makeTempRoot();
    const recordPath = join(rootDir, 'deployments', 'workflows-v2.json');
    const validator = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const agentImpl = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const vaultImpl = '0xcccccccccccccccccccccccccccccccccccccccc';
    const agentBytecode = '0x60016000';
    const vaultBytecode = '0x60026000';
    await writeFile(
      join(
        rootDir,
        'contracts',
        'out',
        'WorkflowAgentFactoryV2.sol',
        'WorkflowAgentFactoryV2.json',
      ),
      JSON.stringify({ bytecode: { object: agentBytecode } }),
    );
    await writeFile(
      join(
        rootDir,
        'contracts',
        'out',
        'WorkflowVaultFactoryV2.sol',
        'WorkflowVaultFactoryV2.json',
      ),
      JSON.stringify({ bytecode: { object: vaultBytecode } }),
    );
    const { concat, encodeAbiParameters } = await import('viem');
    const agentArgs = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
      ['0x8888888888888888888888888888888888888888', validator, agentImpl],
    );
    const vaultArgs = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }],
      [validator, vaultImpl],
    );
    await writeFile(
      recordPath,
      JSON.stringify([
        {
          name: 'Reactive Lasna',
          chainId: TESTNET_CHAINS.lasna.id,
          contract: 'WorkflowAgentFactoryV2',
          address: '0x1111111111111111111111111111111111111111',
          validator,
          implementation: agentImpl,
          blockNumber: 100,
          source: 'commit',
          commit: 'a'.repeat(40),
          dirty: false,
          creationInputHash: keccak256(concat([agentBytecode, agentArgs])),
          runtimeCodeHash: keccak256('0xbeef'),
        },
        {
          name: 'Unichain Sepolia',
          chainId: TESTNET_CHAINS.unichain.id,
          contract: 'WorkflowVaultFactoryV2',
          address: '0x2222222222222222222222222222222222222222',
          validator,
          implementation: vaultImpl,
          blockNumber: 200,
          source: 'commit',
          commit: 'a'.repeat(40),
          dirty: false,
          creationInputHash: keccak256(concat([vaultBytecode, vaultArgs])),
          runtimeCodeHash: keccak256('0xbeef'),
        },
      ]),
    );

    const result = await verifyDeploymentRecord({
      recordPath,
      rootDir,
      contractsDir: join(rootDir, 'contracts'),
      offline: true,
      allowContractDrift: false,
      isMainnet: false,
      chains: TESTNET_CHAINS,
      automationKey: 'lasna',
    });
    expect(result.warnings).toHaveLength(0);
  });
});
