import { expect, test } from '@playwright/test';

test('keeps the page visible offline and recovers when the connection returns', async ({
  context,
  page,
}) => {
  await page.goto('/workflows');
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/You’re offline/)).toBeVisible();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByText(/Still offline/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Check connection' })).toHaveCount(0);
});
