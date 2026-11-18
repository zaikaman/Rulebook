import { expect, test } from '@playwright/test';

test('shows connection failures, hides indexer lag, and keeps the page visible offline', async ({
  context,
  page,
}) => {
  let rpcOk = false;
  await page.route('**/health', (route) =>
    route.fulfill({
      json: {
        status: 'degraded',
        indexer: { enabled: true, lag_seconds: 3107, cursors: [] },
        database: { reachable: true, paused_hint: null },
        chains: [{ chain_id: 5318007, rpc_ok: rpcOk }],
      },
    }),
  );

  await page.goto('/rules');
  await expect(page.getByText(/Chain reads are unavailable on Reactive Lasna/)).toBeVisible();
  await expect(page.getByText(/Indexer updates/)).toHaveCount(0);

  rpcOk = true;
  const retryButton = page.getByRole('button', { name: 'Retry connection' });
  await retryButton.click();
  await expect(page.getByText(/Chain reads are unavailable/)).toHaveCount(0);
  await expect(retryButton).toHaveCount(0);

  await context.setOffline(true);
  await expect(page.getByText(/You’re offline/)).toBeVisible();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByText(/Still offline/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your rules' })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Check connection' })).toHaveCount(0);
});
