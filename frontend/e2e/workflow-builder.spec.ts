import { expect, test } from '@playwright/test';

test('uses the wheel to zoom inside the builder canvas and scroll outside it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/workflows/new?template=blank');
  const canvas = page.locator('.workflow-canvas');
  const viewport = canvas.locator('.react-flow__viewport');
  const workspace = page.locator('.app-shell .app-scroll');
  const zoom = () =>
    viewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
  const scrollTop = () => workspace.evaluate((element) => element.scrollTop);

  await canvas.hover({ position: { x: 70, y: 45 } });
  const initialZoom = await zoom();
  const initialScroll = await scrollTop();
  await page.mouse.wheel(0, 160);
  await expect.poll(zoom).toBeLessThan(initialZoom);
  const zoomedOut = await zoom();
  await page.mouse.wheel(0, -160);
  await expect.poll(zoom).toBeGreaterThan(zoomedOut);
  expect(await scrollTop()).toBe(initialScroll);
});

test('adds a condition from the node library and keeps the draft after a reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('/workflows/new?template=blank');
  const canvas = page.locator('.workflow-canvas');

  await page.getByLabel('Workflow name').fill('Watch the price');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Checks' }).click();
  await page
    .getByRole('button', { name: /^Price is at least/ })
    .dragTo(canvas.locator('[data-id="root"]'));

  await expect(canvas.getByRole('button', { name: 'Condition. Price is at least' })).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'Skip. Do nothing' })).toHaveCount(2);

  await page.reload();
  await expect(page.getByLabel('Workflow name')).toHaveValue('Watch the price');
  await expect(canvas.getByRole('button', { name: 'Condition. Price is at least' })).toBeVisible();
});

test('fits the diagram back to its saved zoom from the canvas controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('/workflows/new?template=blank');
  const canvas = page.locator('.workflow-canvas');
  const readout = canvas.locator('.workflow-canvas-zoom');
  const initialZoom = await readout.textContent();

  await canvas.getByRole('button', { name: /zoom in/i }).click();
  await expect(readout).not.toHaveText(initialZoom ?? '');
  await canvas.getByRole('button', { name: /fit view/i }).click();
  await expect(readout).toHaveText(initialZoom ?? '');
});

test('prevents invalid swap combinations and requires slippage before review', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('/workflows/new?template=blank');
  const inspector = page.getByRole('complementary', { name: 'Workflow inspector' });

  await page.getByLabel('Workflow name').fill('Single swap path');
  await page
    .getByLabel('Workflow diagram')
    .getByRole('button', { name: /^Trigger\./ })
    .click();
  await page.getByLabel('Interval in seconds').fill('3600');

  await inspector.getByRole('button', { name: 'Library', exact: true }).click();
  await inspector.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(inspector.getByRole('button', { name: /^Refill Vault USDC/ })).toBeDisabled();
  await expect(inspector.getByRole('button', { name: /^Send inactivity payout/ })).toBeDisabled();

  await inspector.getByRole('button', { name: /^Buy WETH with USDC/ }).click();
  await inspector.getByRole('button', { name: /^Main path/ }).click();
  await inspector.getByLabel('Amount in USDC').fill('1');

  await inspector.getByRole('button', { name: 'Library', exact: true }).click();
  await inspector.getByRole('button', { name: /^Sell WETH for USDC/ }).click();
  await expect(inspector.getByText('No path can accept this node.')).toBeVisible();

  await page.getByRole('button', { name: 'Workflow settings' }).click();
  await page.getByLabel('Maximum USDC per run').fill('1');
  await expect(
    inspector.getByText('Enter a maximum swap slippage because this workflow buys or sells WETH.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Review workflow' }).click();
  await expect(inspector.getByRole('alert')).toContainText(
    'Enter a maximum swap slippage because this workflow buys or sells WETH.',
  );

  await page.getByLabel('Maximum swap slippage (%)').fill('1');
  await page.getByRole('button', { name: 'Review workflow' }).click();
  await expect(page.getByRole('heading', { name: 'Program review' })).toBeVisible();
});
