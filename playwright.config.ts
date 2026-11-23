import { defineConfig, devices } from '@playwright/test';

import {
  ANVIL_RPC_URL,
  FIXTURE_API_URL,
  FIXTURE_FRONTEND_PORT,
  FIXTURE_FRONTEND_URL,
  WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
  WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
} from './frontend/e2e/fixtureConfig';

/**
 * One smoke path per workflow story lives in frontend/e2e. The specs run against a local anvil
 * and fixture backend; they never touch a public network or a funded wallet.
 */
export default defineConfig({
  testDir: './frontend',
  testMatch: ['e2e/*.spec.ts'],
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
