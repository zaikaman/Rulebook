import { expect, test } from '@playwright/test';

test('retries stale or unavailable chain data and keeps the current page visible offline', async ({
  context,
  page,
}) => {
  let lag = 61;
  let rpcOk = false;
  await page.route('**/health', (route) =>
    route.fulfill({
      json: {
        status: 'degraded',
        indexer: { enabled: true, lag_seconds: lag, cursors: [] },
        database: { reachable: true, paused_hint: null },
        chains: [{ chain_id: 5318007, rpc_ok: rpcOk }],
      },
    }),
  );

  await page.goto('/proof');
  await expect(page.getByText(/Indexer updates are 61s behind/)).toBeVisible();
  await expect(page.getByText(/Chain reads are unavailable on Reactive Lasna/)).toBeVisible();

  lag = 60;
  rpcOk = true;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByText(/Indexer updates/)).toHaveCount(0);
  await expect(page.getByText(/Chain reads are unavailable/)).toHaveCount(0);

  await context.setOffline(true);
  await expect(page.getByText(/You’re offline/)).toBeVisible();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByText(/Still offline/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Execution proof' })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Check connection' })).toHaveCount(0);
});
