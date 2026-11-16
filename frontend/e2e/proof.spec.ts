import { expect, test } from '@playwright/test';

const HASH = `0x${'1'.repeat(64)}`;
const ORIGIN_HASH = `0x${'2'.repeat(64)}`;
const DESTINATION_HASH = `0x${'3'.repeat(64)}`;

const proof = {
  reactive_tx: HASH,
  source: 'chain',
  cache_age_seconds: null,
  latency_ms: 840,
  rows: [
    {
      role: 'origin',
      chain_id: 1301,
      tx_hash: ORIGIN_HASH,
      block_number: 100,
      timestamp: '2026-11-16T10:00:00.000Z',
      explorer_url: `https://sepolia.uniscan.xyz/tx/${ORIGIN_HASH}`,
      error: null,
    },
    {
      role: 'automation',
      chain_id: 5_318_007,
      tx_hash: HASH,
      block_number: 200,
      timestamp: '2026-11-16T10:00:01.000Z',
      explorer_url: `https://reactscan.net/tx/${HASH}`,
      error: null,
    },
    {
      role: 'destination',
      chain_id: 1301,
      tx_hash: DESTINATION_HASH,
      block_number: 101,
      timestamp: '2026-11-16T10:00:02.000Z',
      explorer_url: `https://sepolia.uniscan.xyz/tx/${DESTINATION_HASH}`,
      error: null,
    },
  ],
};

test('renders a three-row proof fixture with one latency and per-chain explorer links', async ({
  page,
}) => {
  await page.route('**/v1/proofs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(proof),
    });
  });

  await page.goto(`/proof/${HASH}`);

  await expect(page.getByTestId('proof-row')).toHaveCount(3);
  await expect(page.getByTestId('proof-latency')).toHaveText('840 ms');

  const hrefs = await page
    .locator('[data-testid="proof-row"] a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));

  expect(hrefs).toEqual([
    `https://sepolia.uniscan.xyz/tx/${ORIGIN_HASH}`,
    `https://reactscan.net/tx/${HASH}`,
    `https://sepolia.uniscan.xyz/tx/${DESTINATION_HASH}`,
  ]);
});
