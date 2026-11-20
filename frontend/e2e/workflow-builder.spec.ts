import { expect, test } from '@playwright/test';

test('builds nested paths and reviews the workflow in plain English', async ({ page }) => {
  await page.goto('/workflows/new?template=blank');
  await page.getByLabel('Workflow name').fill('Sort my payments');
  await page.getByLabel('Maximum USDC per run').fill('1');
  await page.getByRole('button', { name: 'Show outline' }).click();
  await page.getByRole('button', { name: 'Edit the first path' }).click();
  await page.getByRole('button', { name: 'Add condition' }).click();
  await page.getByLabel('Payment is at least (USDC)').fill('1');
  await page.getByRole('button', { name: 'Edit yes path' }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('button', { name: 'Review workflow' }).click();
  await expect(page.getByRole('region', { name: 'Review workflow' })).toContainText(
    'Payment is at least 1 USDC',
  );
  await expect(page.getByRole('region', { name: 'Review workflow' })).toContainText('Do nothing');
  await expect(
    page.getByRole('region', { name: 'Review workflow' }).getByText('Record an alert'),
  ).toHaveCount(2);

  await page.reload();
  await expect(page.getByLabel('Workflow name')).toHaveValue('Sort my payments');
});

test('a phone can edit conditions through the outline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workflows/new?template=payment');
  await page.getByRole('button', { name: 'Payment is at least 1 USDC' }).click();
  await page.getByLabel('Payment is at least (USDC)').fill('2');
  await expect(page.getByRole('button', { name: 'Payment is at least 2 USDC' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show outline' })).toBeHidden();
});
