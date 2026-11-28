import { expect, test, type Page } from '@playwright/test';
import {
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type WorkflowV2RunProof,
} from '@rulebook/shared';

import { ANVIL_LASNA_RPC_URL, ANVIL_RPC_URL, FIXTURE_FRONTEND_URL } from './fixtureConfig';

const sampleRun: WorkflowV2RunProof = {
  id: `0x${'a'.repeat(64)}`,
  chain: UNICHAIN_SEPOLIA_CHAIN_ID,
  programHash: `0x${'b'.repeat(64)}`,
  originChain: UNICHAIN_SEPOLIA_CHAIN_ID,
  originTransaction: `0x${'c'.repeat(64)}`,
  originLogIndex: '7',
  lasnaTransaction: `0x${'d'.repeat(64)}`,
  destinationTransaction: `0x${'e'.repeat(64)}`,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
  status: 'confirmed',
  path: 0,
  reason: null,
};

async function stubRecentAndRunRoutes(
  page: Page,
  runs: readonly WorkflowV2RunProof[],
  options: { readonly includeBlockTimestamps?: boolean } = {},
) {
  const includeBlockTimestamps = options.includeBlockTimestamps ?? true;
  await page.route(
    (url) => url.pathname === '/v3/runs/recent',
    async (route) => {
      await route.fulfill({ json: { runs } });
    },
  );
  for (const run of runs) {
    await page.route(
      (url) => url.pathname === `/v3/runs/${run.id}`,
      async (route) => {
        await route.fulfill({ json: run });
      },
    );
  }

  const t0 = `0x${(1_764_270_000).toString(16)}`;
  const t1 = `0x${(1_764_270_001).toString(16)}`;
  const t3 = `0x${(1_764_270_003).toString(16)}`;
  const blockByHash = new Map<string, { number: string; timestamp: string }>([
    [sampleRun.originTransaction, { number: '0x10', timestamp: t0 }],
    [sampleRun.lasnaTransaction, { number: '0x20', timestamp: t1 }],
    [sampleRun.destinationTransaction!, { number: '0x12', timestamp: t3 }],
  ]);
  const blockByNumber = new Map<string, string>([
    ['0x10', t0],
    ['0x20', t1],
    ['0x12', t3],
  ]);

  await page.route(
    (url) =>
      url.href.replace(/\/$/, '') === ANVIL_RPC_URL ||
      url.href.replace(/\/$/, '') === ANVIL_LASNA_RPC_URL,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const rpc = route.request().postDataJSON() as {
        id: number | string;
        method: string;
        params?: unknown[];
      };
      if (rpc.method === 'eth_getTransactionReceipt') {
        const hash = String(rpc.params?.[0] ?? '').toLowerCase();
        const block = blockByHash.get(hash);
        await route.fulfill({
          headers: { 'access-control-allow-origin': '*' },
          json: {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              transactionHash: hash,
              status: '0x1',
              blockNumber: block?.number ?? '0x10',
              gasUsed: '0x5208',
              effectiveGasPrice: '0x3b9aca00',
            },
          },
        });
        return;
      }
      if (rpc.method === 'eth_getBlockByNumber') {
        const num = String(rpc.params?.[0] ?? '').toLowerCase();
        const timestamp = blockByNumber.get(num);
        await route.fulfill({
          headers: { 'access-control-allow-origin': '*' },
          json: {
            jsonrpc: '2.0',
            id: rpc.id,
            result:
              includeBlockTimestamps && timestamp
                ? {
                    number: num,
                    hash: `0x${'f'.repeat(64)}`,
                    timestamp,
                  }
                : null,
          },
        });
        return;
      }
      return route.fallback();
    },
  );
}

test('opens a featured 3s live proof in one click from the landing page without a wallet', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 940 });
  await stubRecentAndRunRoutes(page, [sampleRun]);

  await page.goto(FIXTURE_FRONTEND_URL + '/');
  const proofSection = page.locator('#proof');
  await expect(proofSection.getByRole('heading', { name: 'Recent verified runs' })).toBeVisible();
  const featuredCard = proofSection.getByRole('link', { name: /Inspect proof/i }).first();
  await expect(featuredCard).toContainText('3s total');
  await expect(featuredCard).toContainText('Origin -> Lasna +1s');
  await expect(featuredCard).toContainText('Lasna -> Settlement +2s');

  await proofSection.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('landing-featured-proof-desktop.png'),
    animations: 'disabled',
  });

  await featuredCard.click();
  await expect(page).toHaveURL(`${FIXTURE_FRONTEND_URL}/runs/${sampleRun.id}?network=testnet`);
  await expect(page.getByRole('heading', { name: 'Workflow run proof' })).toBeVisible();

  const timing = page.getByRole('region', { name: 'Cross-chain timing' });
  await expect(timing).toContainText('Total: 3s');
  await expect(timing).toContainText('Origin -> Lasna');
  await expect(timing).toContainText('+1s');
  await expect(timing).toContainText('Lasna -> Settlement');
  await expect(timing).toContainText('+2s');

  const transactions = page.getByRole('list', { name: 'Run transactions' });
  await expect(transactions).toContainText('Block #16 · Nov 27, 19:00:00 UTC');
  await expect(transactions).toContainText('Block #32 · Nov 27, 19:00:01 UTC');
  await expect(transactions).toContainText('Block #18 · Nov 27, 19:00:03 UTC');
  await expect(transactions.getByText('Transaction execution gas 0.000021 ETH')).toHaveCount(2);
  await expect(transactions.getByText('Transaction execution gas 0.000021 lREACT')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet to start' })).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath('run-proof-latency-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('surfaces recent verified runs on /proof and stays responsive at 390px', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const scheduleRun: WorkflowV2RunProof = {
    ...sampleRun,
    id: `0x${'9'.repeat(64)}`,
    originChain: LASNA_CHAIN_ID,
  };
  await stubRecentAndRunRoutes(page, [sampleRun, scheduleRun]);

  await page.goto(FIXTURE_FRONTEND_URL + '/proof');
  await expect(page.getByRole('heading', { name: 'Recent verified runs' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Recent verified runs' });
  const firstRunLink = list.getByRole('link', { name: /Inspect proof/i }).first();
  await expect(firstRunLink).toContainText('3s');
  expect(await page.locator('main').evaluate((main) => main.scrollWidth)).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: testInfo.outputPath('proof-lookup-recent-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await firstRunLink.click();
  await expect(page).toHaveURL(`${FIXTURE_FRONTEND_URL}/runs/${sampleRun.id}?network=testnet`);
  await expect(page.getByRole('region', { name: 'Cross-chain timing' })).toContainText('Total: 3s');
  expect(await page.locator('main').evaluate((main) => main.scrollWidth)).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: testInfo.outputPath('run-proof-latency-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('degrades cleanly when recent runs are empty or block timestamps are unavailable', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 940 });
  await stubRecentAndRunRoutes(page, [], { includeBlockTimestamps: false });

  await page.goto(FIXTURE_FRONTEND_URL + '/proof');
  await expect(
    page.getByText('No verified runs have been indexed on this network yet.'),
  ).toBeVisible();

  await stubRecentAndRunRoutes(page, [sampleRun], { includeBlockTimestamps: false });
  await page.goto(`${FIXTURE_FRONTEND_URL}/runs/${sampleRun.id}`);
  const timing = page.getByRole('region', { name: 'Cross-chain timing' });
  await expect(timing).toContainText('Block timestamps unavailable from RPC.');
  await expect(timing.getByText('Unavailable', { exact: true })).toHaveCount(2);
  await expect(
    page
      .getByRole('list', { name: 'Run transactions' })
      .getByText('Transaction execution gas 0.000021 ETH'),
  ).toHaveCount(2);
});
