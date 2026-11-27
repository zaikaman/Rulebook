import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { FIXTURE_FRONTEND_URL } from './fixtureConfig';

const screenshotDir = process.env.POOL_PRICE_SCREENSHOT_DIR?.trim();

function maybeScreenshotPath(name: string): string | undefined {
  if (!screenshotDir) return undefined;
  if (!existsSync(screenshotDir)) {
    mkdirSync(screenshotDir, { recursive: true });
  }
  return join(screenshotDir, `${name}.png`);
}

test('reads live pool reserves and applies relative price presets across trading recipes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);

  const recipes = page.getByRole('region', { name: 'Workflow recipes' });
  await expect(recipes).toBeVisible({ timeout: 20_000 });

  // Limit buy on Unichain Sepolia (2,500.00 USDC/WETH from Anvil MockPair)
  await recipes.getByRole('button', { name: /Limit buy/i }).click();
  await expect(page.getByText('Spot · Unichain Sepolia')).toBeVisible();
  await expect(page.getByText('2,500.00')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /Set price to -5% from spot/i }).click();
  const limitInput = page.getByLabel('Limit price (USDC per WETH)');
  await expect(limitInput).toHaveValue('2375');
  await expect(page.getByRole('button', { name: /Set price to -5% from spot/i })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('-5.0% vs spot')).toBeVisible();

  const desktopRecipeShot = maybeScreenshotPath('recipe-limit-buy-desktop');
  if (desktopRecipeShot) {
    await page.locator('.rb-configurator').screenshot({ path: desktopRecipeShot });
  }

  // Switch Settlement network to Base Sepolia (2,600.00 USDC/WETH from Anvil MockPair)
  await page
    .getByRole('combobox')
    .filter({ hasText: /Unichain Sepolia/i })
    .first()
    .click();
  await page.getByRole('option', { name: 'Base Sepolia' }).click();

  await expect(page.getByText('Spot · Base Sepolia')).toBeVisible();
  await expect(page.getByText('2,600.00')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /Set price to -2% from spot/i }).click();
  await expect(limitInput).toHaveValue('2548');
  await expect(page.getByText('-2.0% vs spot')).toBeVisible();

  // Take profit (+10%)
  await recipes.getByRole('button', { name: /Take profit/i }).click();
  await expect(page.getByText('2,600.00')).toBeVisible();
  await page.getByRole('button', { name: /Set price to \+10% from spot/i }).click();
  await expect(page.getByLabel('Target price (USDC per WETH)')).toHaveValue('2860');

  // Trailing stop (-5%)
  await recipes.getByRole('button', { name: /Trailing stop/i }).click();
  await page.getByRole('button', { name: /Set price to -5% from spot/i }).click();
  await expect(page.getByLabel('Stop price (USDC per WETH)')).toHaveValue('2470');

  // Price-band trading (Spot)
  await recipes.getByRole('button', { name: /Price-band trading/i }).click();
  await page.getByRole('button', { name: /Set price to spot/i }).click();
  await expect(page.getByLabel('Starting reference price (USDC per WETH)')).toHaveValue('2600');
  await expect(page.getByText('At spot')).toBeVisible();

  // Mobile layout check
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileRecipeShot = maybeScreenshotPath('recipe-price-band-mobile');
  if (mobileRecipeShot) {
    await page.locator('.rb-configurator').screenshot({ path: mobileRecipeShot });
  }
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test('shows the pool used by price and transfer triggers in the canvas condition inspector', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);

  const recipes = page.getByRole('region', { name: 'Workflow recipes' });
  await recipes.getByRole('button', { name: /Limit buy/i }).click();
  await expect(page.getByText('2,500.00')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /Set price to -5% from spot/i }).click();
  await page.getByLabel('USDC to spend').fill('1');
  await page.getByLabel('Maximum slippage (%)').fill('1');
  await page.getByLabel('Expires at (Unix seconds)').fill('2000000000');
  await page.getByRole('button', { name: 'Open in builder' }).click();

  const canvas = page.getByLabel('Workflow diagram');
  const inspector = page.getByRole('complementary', { name: 'Workflow inspector' });

  await canvas.getByRole('button', { name: /Condition\. Price is at most/i }).click();
  await expect(inspector.getByText('Spot · Unichain Sepolia')).toBeVisible();
  await expect(inspector.getByText('2,500.00')).toBeVisible();
  await expect(inspector.getByText('-5.0% vs spot')).toBeVisible();

  const desktopInspectorShot = maybeScreenshotPath('inspector-condition-desktop');
  if (desktopInspectorShot) {
    await inspector.screenshot({ path: desktopInspectorShot });
  }

  // Switch Trigger origin network to Base Sepolia and verify condition inspector reads Base spot.
  await canvas.getByRole('button', { name: /^Trigger\./ }).click();
  await inspector
    .getByRole('combobox')
    .filter({ hasText: /Unichain Sepolia/i })
    .last()
    .click();
  await page.getByRole('option', { name: 'Base Sepolia' }).click();

  await canvas.getByRole('button', { name: /Condition\. Price is at most/i }).click();
  await expect(inspector.getByText('Spot · Base Sepolia')).toBeVisible();
  await expect(inspector.getByText('2,600.00')).toBeVisible({ timeout: 15_000 });

  await inspector.getByRole('button', { name: /Set price to \+5% from spot/i }).click();
  await expect(inspector.getByLabel('Price is at most threshold')).toHaveValue('2730');
  await expect(inspector.getByText('+5.0% vs spot')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileInspectorShot = maybeScreenshotPath('inspector-condition-mobile');
  if (mobileInspectorShot) {
    await inspector.screenshot({ path: mobileInspectorShot });
  }

  await inspector.getByRole('button', { name: 'Library' }).click();
  await inspector.getByRole('button', { name: 'Triggers' }).click();
  await inspector.getByRole('button', { name: /Token transfer/ }).click();
  await inspector.getByRole('button', { name: /Use as trigger/ }).click();
  await expect(canvas.getByRole('button', { name: /Trigger\. Token transfer/i })).toBeVisible();
  await expect(inspector.getByRole('combobox').filter({ hasText: 'Base Sepolia' })).toBeVisible();
  await canvas.getByRole('button', { name: /Condition\. Price is at most/i }).click();
  await expect(inspector.getByText('Spot · Unichain Sepolia')).toBeVisible();
  await inspector.getByRole('button', { name: /Set price to \+5% from spot/i }).click();
  await expect(inspector.getByLabel('Price is at most threshold')).toHaveValue('2625');
});
