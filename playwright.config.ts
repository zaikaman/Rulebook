import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import {
  ANVIL_BASE_RPC_URL,
  ANVIL_LASNA_RPC_URL,
  ANVIL_RPC_URL,
  FIXTURE_API_URL,
  FIXTURE_FRONTEND_PORT,
  FIXTURE_FRONTEND_URL,
  WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
  WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS,
  WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
} from './frontend/e2e/fixtureConfig';

const require = createRequire(import.meta.url);
function resolveBin(pkg: string, binName: string, searchPaths: string[]): string {
  const pkgPath = require.resolve(`${pkg}/package.json`, { paths: searchPaths });
  const meta = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof meta.bin === 'string' ? meta.bin : meta.bin[binName];
  return resolve(dirname(pkgPath), rel!);
}

const viteBin = resolveBin('vite', 'vite', [resolve(import.meta.dirname, 'frontend')]);
const tsxBin = resolveBin('tsx', 'tsx', [
  import.meta.dirname,
  resolve(import.meta.dirname, 'packages/shared'),
  resolve(import.meta.dirname, 'backend'),
]);

/**
 * One smoke path per workflow story lives in frontend/e2e. The specs run against a local anvil
 * and fixture backend; they never touch a public network or a funded wallet.
 */
export default defineConfig({
  testDir: './frontend',
  testMatch: ['e2e/*.spec.ts'],
  fullyParallel: true,
  // Each chain-writing test uses its own Anvil account so workers run in parallel without nonce contention.
  workers: process.env.CI ? 4 : Math.min(8, Math.max(4, Math.floor(cpus().length / 2))),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: FIXTURE_FRONTEND_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node "${tsxBin}" frontend/e2e/fixture-server.ts`,
      url: `${FIXTURE_API_URL}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: `node "${viteBin}" --port ${FIXTURE_FRONTEND_PORT} --strictPort`,
      cwd: 'frontend',
      url: FIXTURE_FRONTEND_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: FIXTURE_API_URL,
        VITE_WALLETCONNECT_PROJECT_ID: '',
        VITE_LASNA_RPC_URL: ANVIL_LASNA_RPC_URL,
        VITE_UNICHAIN_RPC_URL: ANVIL_RPC_URL,
        VITE_BASE_SEPOLIA_RPC_URL: ANVIL_BASE_RPC_URL,
        VITE_WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
          lasna: { factory: WORKFLOW_V2_AGENT_FACTORY_ADDRESS, startBlock: 1 },
          unichain: { factory: WORKFLOW_V2_VAULT_FACTORY_ADDRESS, startBlock: 1 },
          base: { factory: WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS, startBlock: 1 },
        }),
        VITE_WORKFLOW_V2_ACTIVATION: 'true',
      },
    },
  ],
});
