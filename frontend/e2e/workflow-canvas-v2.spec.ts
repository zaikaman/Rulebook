import { expect, test } from '@playwright/test';
import { FIXTURE_FRONTEND_URL } from './fixtureConfig';

/** Library nodes render a suffix such as "Adds a condition", so match the name as a prefix. */
function nodeName(name: string) {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
}

test('opens the original 13 recipes and reviews a branching income sweep from the canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);
  const recipes = page.getByRole('region', { name: 'Workflow recipes' });
  await expect(recipes.getByRole('listitem')).toHaveCount(13);
  await recipes.getByRole('button', { name: 'Income sweep', exact: false }).click();
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
  const library = page.getByRole('complementary', { name: 'Workflow inspector' });
  await library.getByRole('button', { name: 'Library', exact: true }).click();
  await library.getByRole('button', { name: 'Notifications', exact: true }).click();
  await library
    .getByRole('button', { name: 'Record an alert' })
    .dragTo(canvas.getByRole('button', { name: 'Skip. Do nothing' }));
  await expect(canvas.getByText('Record an alert', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Review workflow' }).click();
  await expect(page.getByRole('heading', { name: 'Income sweep', level: 1 })).toBeVisible();
  const review = page.locator('.rb-review-program');
  await expect(review.getByRole('heading', { name: 'Program review' })).toBeVisible();
  const settlement = review.locator('dl > div').filter({ hasText: 'Settlement network' });
  await expect(settlement.locator('dd')).toHaveText('Unichain Sepolia');
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  await expect(review.getByText('0.2 USDC · 0 WETH')).toBeVisible();
});

test('places live balance and refill nodes without dragging on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  const library = page.getByRole('complementary', { name: 'Workflow inspector' });
  const libraryTab = library.getByRole('button', { name: 'Library', exact: true });
  await libraryTab.click();
  await library.getByRole('button', { name: 'Checks', exact: true }).click();
  await library.getByRole('button', { name: nodeName('Vault USDC is below') }).click();
  await library.getByRole('button', { name: /^Main path/ }).click();
  await libraryTab.click();
  await library.getByRole('button', { name: 'Actions', exact: true }).click();
  await library.getByRole('button', { name: nodeName('Refill Vault USDC') }).click();
  await library.getByRole('button', { name: /^Yes path/ }).click();
  await expect(
    page.getByLabel('Workflow diagram').getByText('Refill Vault USDC', { exact: true }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 760 },
  { width: 390, height: 844 },
]) {
  test(`keeps scrolling inside the inspector at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);
    await page.getByRole('button', { name: 'Start from scratch' }).click();

    const canvas = page.getByLabel('Workflow diagram');
    const inspector = page.getByRole('complementary', { name: 'Workflow inspector' });
    const content = inspector.getByRole('region', { name: 'Inspector content' });
    await expect(canvas).toBeInViewport({ ratio: 1 });
    await expect(inspector).toBeInViewport({ ratio: 1 });
    await expect(content).toHaveCSS('scrollbar-width', 'thin');

    await content.focus();
    await page.keyboard.press('End');
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(content.getByText('Close after a confirmed run')).toBeInViewport();
    expect(
      await page.getByRole('main').evaluate((element) => ({
        workspaceOverflow: element.scrollHeight - element.clientHeight,
        pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
      })),
    ).toEqual({ workspaceOverflow: 0, pageOverflow: 0 });

    const properties = inspector.getByRole('button', { name: 'Properties', exact: true });
    await expect(properties).toBeInViewport({ ratio: 1 });
    await canvas.getByRole('button', { name: /^Trigger\./ }).click();
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(page.getByRole('button', { name: 'Review workflow' })).toBeInViewport();
  });
}
