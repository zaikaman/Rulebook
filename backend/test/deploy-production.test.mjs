import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildFrontendEnvLines,
  validateHerokuWorkflowConfig,
  workflowSettings,
} from '../../scripts/deploy-production.mjs';

const TESTNET_AGENT_FACTORY = '0x5659ee98f8e34f5e0635bc010de65d1511c8169a';
const TESTNET_UNICHAIN_FACTORY = '0x77cad43cbea7f72f128d632b7dcb8638004d5070';
const TESTNET_BASE_FACTORY = '0xc0acbc2d8542e6d33e6262397feeb9b487a50299';

const MAINNET_AGENT_FACTORY = '0x1111111111111111111111111111111111111111';
const MAINNET_UNICHAIN_FACTORY = '0x2222222222222222222222222222222222222222';
const MAINNET_BASE_FACTORY = '0x3333333333333333333333333333333333333333';

function testnetRecords() {
  return [
    {
      contract: 'WorkflowAgentFactoryV2',
      chainId: 5318007,
      address: TESTNET_AGENT_FACTORY,
      blockNumber: 9202443,
    },
    {
      contract: 'WorkflowVaultFactoryV2',
      chainId: 1301,
      address: TESTNET_UNICHAIN_FACTORY,
      blockNumber: 68741449,
    },
    {
      contract: 'WorkflowVaultFactoryV2',
      chainId: 84532,
      address: TESTNET_BASE_FACTORY,
      blockNumber: 63360131,
    },
  ];
}

function mainnetRecords({ includeBase = true, agentFactory = MAINNET_AGENT_FACTORY } = {}) {
  return [
    {
      contract: 'WorkflowAgentFactoryV2',
      chainId: 1597,
      address: agentFactory,
      blockNumber: 123456,
    },
    {
      contract: 'WorkflowVaultFactoryV2',
      chainId: 130,
      address: MAINNET_UNICHAIN_FACTORY,
      blockNumber: 234567,
    },
    ...(includeBase
      ? [
          {
            contract: 'WorkflowVaultFactoryV2',
            chainId: 8453,
            address: MAINNET_BASE_FACTORY,
            blockNumber: 345678,
          },
        ]
      : []),
  ];
}

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'rulebook-deploy-prod-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('deploy-production', () => {
  describe('workflowSettings', () => {
    it('returns only WORKFLOW_V2_DEPLOYMENT when mainnet deployment record is absent', async () => {
      const dir = await makeTempDir();
      const testnetPath = join(dir, 'workflows-v2.json');
      const mainnetPath = join(dir, 'workflows-v2-mainnet.json');
      await writeFile(testnetPath, JSON.stringify(testnetRecords()));

      const settings = await workflowSettings({ testnetPath, mainnetPath });

      expect(settings).toEqual({
        WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
          lasna: { factory: TESTNET_AGENT_FACTORY, startBlock: 9202443 },
          unichain: { factory: TESTNET_UNICHAIN_FACTORY, startBlock: 68741449 },
          base: { factory: TESTNET_BASE_FACTORY, startBlock: 63360131 },
        }),
      });
    });

    it('loads both testnet and mainnet deployment records (with and without Base mainnet)', async () => {
      const dir = await makeTempDir();
      const testnetPath = join(dir, 'workflows-v2.json');
      const mainnetPath = join(dir, 'workflows-v2-mainnet.json');
      await writeFile(testnetPath, JSON.stringify(testnetRecords()));
      await writeFile(mainnetPath, JSON.stringify(mainnetRecords({ includeBase: true })));

      const withBase = await workflowSettings({ testnetPath, mainnetPath });
      expect(withBase.WORKFLOW_V2_MAINNET_DEPLOYMENT).toBe(
        JSON.stringify({
          reactive: { factory: MAINNET_AGENT_FACTORY, startBlock: 123456 },
          unichain: { factory: MAINNET_UNICHAIN_FACTORY, startBlock: 234567 },
          base: { factory: MAINNET_BASE_FACTORY, startBlock: 345678 },
        }),
      );

      await writeFile(mainnetPath, JSON.stringify(mainnetRecords({ includeBase: false })));
      const withoutBase = await workflowSettings({ testnetPath, mainnetPath });
      expect(withoutBase.WORKFLOW_V2_MAINNET_DEPLOYMENT).toBe(
        JSON.stringify({
          reactive: { factory: MAINNET_AGENT_FACTORY, startBlock: 123456 },
          unichain: { factory: MAINNET_UNICHAIN_FACTORY, startBlock: 234567 },
        }),
      );
    });

    it('rejects malformed JSON or missing factory entries in mainnet record', async () => {
      const dir = await makeTempDir();
      const testnetPath = join(dir, 'workflows-v2.json');
      const mainnetPath = join(dir, 'workflows-v2-mainnet.json');
      await writeFile(testnetPath, JSON.stringify(testnetRecords()));

      await writeFile(mainnetPath, '{not valid json');
      await expect(workflowSettings({ testnetPath, mainnetPath })).rejects.toThrow(
        /Invalid JSON in deployments\/workflows-v2-mainnet\.json/,
      );

      await writeFile(mainnetPath, JSON.stringify(mainnetRecords().slice(0, 1)));
      await expect(workflowSettings({ testnetPath, mainnetPath })).rejects.toThrow(
        /Invalid deployment record for WorkflowVaultFactoryV2 in deployments\/workflows-v2-mainnet\.json/,
      );
    });

    it('rejects a mainnet record whose Reactive Agent factory matches Reactive Lasna', async () => {
      const dir = await makeTempDir();
      const testnetPath = join(dir, 'workflows-v2.json');
      const mainnetPath = join(dir, 'workflows-v2-mainnet.json');
      await writeFile(testnetPath, JSON.stringify(testnetRecords()));
      await writeFile(
        mainnetPath,
        JSON.stringify(mainnetRecords({ agentFactory: TESTNET_AGENT_FACTORY.toUpperCase() })),
      );

      await expect(workflowSettings({ testnetPath, mainnetPath })).rejects.toThrow(
        /Reactive Mainnet WorkflowAgentFactoryV2 must not match Reactive Lasna/,
      );
    });

    it('rejects zero addresses and duplicate deployment entries', async () => {
      const dir = await makeTempDir();
      const testnetPath = join(dir, 'workflows-v2.json');
      const mainnetPath = join(dir, 'workflows-v2-mainnet.json');
      await writeFile(testnetPath, JSON.stringify(testnetRecords()));

      await writeFile(
        mainnetPath,
        JSON.stringify(mainnetRecords({ agentFactory: '0x' + '0'.repeat(40) })),
      );
      await expect(workflowSettings({ testnetPath, mainnetPath })).rejects.toThrow(
        /Invalid deployment record for WorkflowAgentFactoryV2/,
      );

      await writeFile(
        mainnetPath,
        JSON.stringify([...mainnetRecords(), ...mainnetRecords().slice(0, 1)]),
      );
      await expect(workflowSettings({ testnetPath, mainnetPath })).rejects.toThrow(
        /Duplicate deployment record for WorkflowAgentFactoryV2/,
      );
    });
  });

  describe('validateHerokuWorkflowConfig', () => {
    it('accepts matching testnet and mainnet config regardless of key order or address casing', () => {
      const settings = {
        WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
          lasna: { factory: TESTNET_AGENT_FACTORY, startBlock: 10 },
          unichain: { factory: TESTNET_UNICHAIN_FACTORY, startBlock: 20 },
        }),
        WORKFLOW_V2_MAINNET_DEPLOYMENT: JSON.stringify({
          reactive: { factory: MAINNET_AGENT_FACTORY, startBlock: 30 },
          unichain: { factory: MAINNET_UNICHAIN_FACTORY, startBlock: 40 },
        }),
      };

      expect(() =>
        validateHerokuWorkflowConfig(
          {
            WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
              unichain: { startBlock: 20, factory: TESTNET_UNICHAIN_FACTORY.toUpperCase() },
              lasna: { startBlock: 10, factory: TESTNET_AGENT_FACTORY.toUpperCase() },
            }),
            WORKFLOW_V2_MAINNET_DEPLOYMENT: JSON.stringify({
              unichain: { startBlock: 40, factory: MAINNET_UNICHAIN_FACTORY.toUpperCase() },
              reactive: { startBlock: 30, factory: MAINNET_AGENT_FACTORY.toUpperCase() },
            }),
          },
          settings,
        ),
      ).not.toThrow();
    });

    it('rejects missing or drifted WORKFLOW_V2_MAINNET_DEPLOYMENT when mainnet record exists', () => {
      const settings = {
        WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
          lasna: { factory: TESTNET_AGENT_FACTORY, startBlock: 10 },
          unichain: { factory: TESTNET_UNICHAIN_FACTORY, startBlock: 20 },
        }),
        WORKFLOW_V2_MAINNET_DEPLOYMENT: JSON.stringify({
          reactive: { factory: MAINNET_AGENT_FACTORY, startBlock: 30 },
          unichain: { factory: MAINNET_UNICHAIN_FACTORY, startBlock: 40 },
        }),
      };

      expect(() =>
        validateHerokuWorkflowConfig(
          { WORKFLOW_V2_DEPLOYMENT: settings.WORKFLOW_V2_DEPLOYMENT },
          settings,
        ),
      ).toThrow(
        /WORKFLOW_V2_MAINNET_DEPLOYMENT must match deployments\/workflows-v2-mainnet\.json/,
      );

      expect(() =>
        validateHerokuWorkflowConfig(
          {
            WORKFLOW_V2_DEPLOYMENT: settings.WORKFLOW_V2_DEPLOYMENT,
            WORKFLOW_V2_MAINNET_DEPLOYMENT: JSON.stringify({
              reactive: { factory: MAINNET_AGENT_FACTORY, startBlock: 31 },
              unichain: { factory: MAINNET_UNICHAIN_FACTORY, startBlock: 40 },
            }),
          },
          settings,
        ),
      ).toThrow(
        /WORKFLOW_V2_MAINNET_DEPLOYMENT must match deployments\/workflows-v2-mainnet\.json/,
      );
    });

    it('rejects stale Heroku WORKFLOW_V2_MAINNET_DEPLOYMENT when mainnet record is missing', () => {
      const settings = {
        WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
          lasna: { factory: TESTNET_AGENT_FACTORY, startBlock: 10 },
          unichain: { factory: TESTNET_UNICHAIN_FACTORY, startBlock: 20 },
        }),
      };

      expect(() =>
        validateHerokuWorkflowConfig(
          {
            WORKFLOW_V2_DEPLOYMENT: settings.WORKFLOW_V2_DEPLOYMENT,
            WORKFLOW_V2_MAINNET_DEPLOYMENT: JSON.stringify({
              reactive: { factory: MAINNET_AGENT_FACTORY, startBlock: 30 },
              unichain: { factory: MAINNET_UNICHAIN_FACTORY, startBlock: 40 },
            }),
          },
          settings,
        ),
      ).toThrow(
        /WORKFLOW_V2_MAINNET_DEPLOYMENT is set, but deployments\/workflows-v2-mainnet\.json is missing/,
      );
    });
  });

  describe('buildFrontendEnvLines', () => {
    it('emits empty VITE_WORKFLOW_V2_MAINNET_DEPLOYMENT when mainnet is absent and forwards mainnet config & RPC overrides when present', () => {
      const testnetOnly = {
        WORKFLOW_V2_DEPLOYMENT: '{"lasna":{"factory":"0x1","startBlock":1}}',
      };
      expect(
        buildFrontendEnvLines({
          server: 'https://api.example.com',
          settings: testnetOnly,
          envMap: {},
        }),
      ).toEqual([
        'VITE_API_BASE_URL=https://api.example.com',
        'VITE_WORKFLOW_V2_DEPLOYMENT={"lasna":{"factory":"0x1","startBlock":1}}',
        'VITE_WORKFLOW_V2_MAINNET_DEPLOYMENT=',
      ]);

      const withMainnet = {
        ...testnetOnly,
        WORKFLOW_V2_MAINNET_DEPLOYMENT: '{"reactive":{"factory":"0x2","startBlock":2}}',
      };
      expect(
        buildFrontendEnvLines({
          server: 'https://api.example.com',
          settings: withMainnet,
          envMap: {
            VITE_UNICHAIN_MAINNET_RPC_URL: 'https://rpc.example.com/v2/abc',
            UNICHAIN_MAINNET_RPC_URL: 'https://fallback.example.com',
            BASE_MAINNET_RPC_URL: 'https://base-rpc.example.com',
            VITE_REACTIVE_MAINNET_WALLET_RPC_URL: 'https://wallet.example.com',
            WORKFLOW_V2_ACTIVATION: 'true',
          },
        }),
      ).toEqual([
        'VITE_API_BASE_URL=https://api.example.com',
        'VITE_WORKFLOW_V2_DEPLOYMENT={"lasna":{"factory":"0x1","startBlock":1}}',
        'VITE_WORKFLOW_V2_MAINNET_DEPLOYMENT={"reactive":{"factory":"0x2","startBlock":2}}',
        'VITE_UNICHAIN_MAINNET_RPC_URL=https://rpc.example.com/v2/abc',
        'VITE_BASE_MAINNET_RPC_URL=https://base-rpc.example.com/',
        'VITE_REACTIVE_MAINNET_WALLET_RPC_URL=https://wallet.example.com/',
        'VITE_WORKFLOW_V2_ACTIVATION=true',
      ]);
    });

    it('rejects non-HTTPS or credentialed RPC overrides and invalid activation flags', () => {
      const settings = { WORKFLOW_V2_DEPLOYMENT: '{}' };
      expect(() =>
        buildFrontendEnvLines({
          server: 'https://api.example.com',
          settings,
          envMap: { VITE_UNICHAIN_MAINNET_RPC_URL: 'http://insecure.example.com' },
        }),
      ).toThrow(/VITE_UNICHAIN_MAINNET_RPC_URL must be a public HTTPS URL/);

      expect(() =>
        buildFrontendEnvLines({
          server: 'https://api.example.com',
          settings,
          envMap: { VITE_BASE_MAINNET_RPC_URL: 'https://user:pass@rpc.example.com' },
        }),
      ).toThrow(/VITE_BASE_MAINNET_RPC_URL must be a public HTTPS URL/);

      expect(() =>
        buildFrontendEnvLines({
          server: 'https://api.example.com',
          settings,
          envMap: { WORKFLOW_V2_ACTIVATION: 'yes' },
        }),
      ).toThrow(/WORKFLOW_V2_ACTIVATION must be "true" or "false"/);
    });
  });
});
