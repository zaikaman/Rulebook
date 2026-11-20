import { defineConfig, devices } from '@playwright/test';

import {
  AGENT_FACTORY_ADDRESS,
  ANVIL_RPC_URL,
  FIXTURE_API_URL,
  FIXTURE_FRONTEND_PORT,
  FIXTURE_FRONTEND_URL,
  FIXTURE_V2_FRONTEND_PORT,
  FIXTURE_V2_FRONTEND_URL,
  VAULT_FACTORY_ADDRESS,
  WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
  WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
} from './frontend/e2e/fixtureConfig';

/**
 * One smoke path per story lives in frontend/e2e. The onboarding spec runs against a local
 * anvil + fixture backend; it never touches a public network or a funded wallet.
 */
export default defineConfig({
  testDir: './frontend',
  testMatch: ['e2e/*.spec.ts', 'test/a11y.test.tsx'],
  fullyParallel: false,
  // Every spec shares one anvil and one sponsor nonce sequence, so they must not overlap.
  workers: 1,
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
      command: 'npx tsx frontend/e2e/fixture-server.ts',
      url: `${FIXTURE_API_URL}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -w frontend -- --port ${FIXTURE_FRONTEND_PORT} --strictPort`,
      url: FIXTURE_FRONTEND_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: FIXTURE_API_URL,
        VITE_LEGACY_WORKSPACE: 'true',
        VITE_WALLETCONNECT_PROJECT_ID: '',
        VITE_LASNA_RPC_URL: ANVIL_RPC_URL,
        VITE_UNICHAIN_RPC_URL: ANVIL_RPC_URL,
        VITE_AGENT_FACTORY_ADDRESS: AGENT_FACTORY_ADDRESS,
        VITE_VAULT_FACTORY_ADDRESS: VAULT_FACTORY_ADDRESS,
      },
    },
    {
      command: `npm run dev -w frontend -- --port ${FIXTURE_V2_FRONTEND_PORT} --strictPort`,
      url: FIXTURE_V2_FRONTEND_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        VITE_API_BASE_URL: FIXTURE_API_URL,
        VITE_LEGACY_WORKSPACE: 'false',
        VITE_WALLETCONNECT_PROJECT_ID: '',
        VITE_LASNA_RPC_URL: ANVIL_RPC_URL,
        VITE_UNICHAIN_RPC_URL: ANVIL_RPC_URL,
        VITE_WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
          lasna: { factory: WORKFLOW_V2_AGENT_FACTORY_ADDRESS, startBlock: 1 },
          unichain: { factory: WORKFLOW_V2_VAULT_FACTORY_ADDRESS, startBlock: 1 },
        }),
        VITE_WORKFLOW_V2_ACTIVATION: 'true',
      },
    },
  ],
});
