import { expect, test } from '@playwright/test';
import { FIXTURE_V2_FRONTEND_URL } from './fixtureConfig';

test('opens the original 13 recipes and reviews a branching income sweep from the canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto(`${FIXTURE_V2_FRONTEND_URL}/workflows/new`);
  const recipes = page.getByRole('region', { name: 'Workflow recipes' });
  await expect(recipes.getByRole('listitem')).toHaveCount(13);
  await recipes.getByRole('button', { name: /^Income sweep/ }).click();
  await page.getByLabel('Minimum payment (USDC)').fill('1');
  await page.getByLabel('USDC to send').fill('0.2');
  await page.getByLabel('Smaller payment threshold (USDC, optional)').fill('0.25');
  await page.getByLabel('Smaller sweep amount (USDC, optional)').fill('0.05');
  const recipient = '0x0000000000000000000000000000000000000002';
  await page.getByLabel('Recipient address').fill(recipient);
  await page.getByRole('button', { name: 'Open in builder' }).click();

  const canvas = page.getByLabel('Workflow diagram');
  await expect(canvas.getByText('Yes', { exact: true })).toHaveCount(2);
  await expect(canvas.getByText('Otherwise', { exact: true })).toHaveCount(2);
  await expect(canvas.getByText('Send USDC', { exact: true })).toHaveCount(2);
  await expect(canvas.getByText('Do nothing', { exact: true })).toBeVisible();
  const library = page.getByRole('complementary', { name: 'Node library' });
  await library.getByRole('button', { name: 'Notifications', exact: true }).click();
  await library
    .getByRole('button', { name: 'Record an alert' })
    .dragTo(canvas.getByRole('button', { name: 'Skip. Do nothing' }));
  await expect(canvas.getByText('Record an alert', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Review workflow' }).click();
  await expect(page.getByRole('heading', { name: 'Review Income sweep' })).toBeVisible();
  await expect(page.getByText('Unichain Sepolia', { exact: true })).toBeVisible();
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  await expect(page.getByText('0.2 USDC · 0 WETH')).toBeVisible();
});

test('places live balance and refill nodes without dragging on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_V2_FRONTEND_URL}/workflows/new`);
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  const library = page.getByRole('complementary', { name: 'Node library' });
  await library.getByRole('button', { name: 'Checks', exact: true }).click();
  await library.getByRole('button', { name: 'Vault USDC is below', exact: true }).click();
  await page.getByRole('button', { name: 'Add Vault USDC is below here' }).click();
  await library.getByRole('button', { name: 'Actions', exact: true }).click();
  await library.getByRole('button', { name: 'Refill Vault USDC', exact: true }).click();
  await page
    .getByRole('region', { name: 'Yes path' })
    .getByRole('button', { name: 'Add Refill Vault USDC here' })
    .click();
  await expect(
    page.getByLabel('Workflow diagram').getByText('Refill Vault USDC', { exact: true }),
  ).toBeVisible();
});
