import { expect, test } from '@playwright/test';

import { FIXTURE_FRONTEND_URL } from './fixtureConfig';

test('simulates a multi-branch income sweep and highlights the exact canvas path', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);

  const recipes = page.getByRole('region', { name: 'Workflow recipes' });
  await recipes.getByRole('button', { name: 'Income sweep', exact: false }).click();
  await page.getByLabel('Minimum payment (USDC)').fill('1');
  await page.getByLabel('USDC to send').fill('0.2');
  await page.getByLabel('Smaller payment threshold (USDC, optional)').fill('0.25');
  await page.getByLabel('Smaller sweep amount (USDC, optional)').fill('0.05');
  await page.getByLabel('Recipient address').fill('0x0000000000000000000000000000000000000002');
  await page.getByRole('button', { name: 'Open in builder' }).click();

  const canvas = page.getByLabel('Workflow diagram');
  const inspector = page.getByRole('complementary', { name: 'Workflow inspector' });

  await inspector.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'Test this workflow' })).toBeVisible();

  const paymentInput = inspector.getByLabel('Incoming payment (USDC)');
  const verdict = inspector.getByRole('status');
  const reset = inspector.getByRole('button', { name: 'Reset scenario' });
  await expect(reset).toBeDisabled();
  await inspector
    .getByRole('group', { name: 'Example scenarios' })
    .getByRole('button', { name: /Small/ })
    .click();
  await expect(verdict).toContainText('Skipped');
  await reset.click();
  await expect(verdict).toContainText('Would execute');
  await expect(reset).toBeDisabled();

  await paymentInput.fill('0.60');

  await expect(canvas).toHaveAttribute('data-has-match', 'true');
  await expect(canvas.locator('.workflow-node-card[data-matched="true"]')).toHaveCount(4);
  await expect(
    canvas.locator('.workflow-node-card[data-matched="true"]', { hasText: '0.05 USDC' }),
  ).toBeVisible();
  await expect(
    canvas.locator('.workflow-node-card[data-matched="true"]', { hasText: '0.2 USDC' }),
  ).toHaveCount(0);
  await expect(
    canvas.locator('.workflow-node-card[data-matched="true"]', { hasText: 'Do nothing' }),
  ).toHaveCount(0);

  await expect(verdict).toContainText('Would execute');
  await expect(inspector.getByLabel('Simulated actions')).toContainText('0.05 USDC');
  await inspector.getByText('Decision path', { exact: true }).click();
  await expect(
    inspector.getByRole('button', { name: /Amount is at least.*Otherwise/ }),
  ).toBeVisible();
  await inspector.getByText('Decision path', { exact: true }).click();

  await page.screenshot({
    path: testInfo.outputPath('simulator-income-sweep-desktop.png'),
    animations: 'disabled',
  });

  await paymentInput.fill('0.10');
  await expect(
    canvas.locator('.workflow-node-card[data-matched="true"]', { hasText: 'Do nothing' }),
  ).toBeVisible();
  await expect(verdict).toContainText('Skipped');

  // Verify weekly budget check skips when weekly limit is tighter than the matched path spend.
  await page.getByRole('button', { name: 'Workflow settings' }).click();
  await inspector.getByLabel('Weekly USDC budget (optional)').fill('0.04');
  await inspector.getByRole('button', { name: 'Test', exact: true }).click();
  await inspector.getByLabel('Incoming payment (USDC)').fill('0.60');
  await expect(verdict).toContainText('weekly USDC budget exceeded');
  const priorSpending = inspector.getByLabel('Already spent this week (USDC)');
  await expect(priorSpending).toBeHidden();
  await inspector.getByText('Weekly spending', { exact: true }).click();
  await expect(priorSpending).toBeVisible();
});

test('simulates trailing stop drop and per-run cap blocks with live canvas highlight', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);

  const recipes = page.getByRole('region', { name: 'Workflow recipes' });
  await recipes.getByRole('button', { name: 'Trailing stop', exact: false }).click();
  await page.getByLabel('Stop price (USDC per WETH)').fill('1250');
  await page.getByLabel('Trail from high price (%)').fill('8');
  await page.getByLabel('WETH to sell').fill('0.05');
  await page.getByLabel('Maximum slippage (%)').fill('1');
  await page.getByRole('button', { name: 'Open in builder' }).click();

  const canvas = page.getByLabel('Workflow diagram');
  const inspector = page.getByRole('complementary', { name: 'Workflow inspector' });
  await inspector.getByRole('button', { name: 'Test', exact: true }).click();

  const highInput = inspector.getByLabel('Trailing high price (USDC per WETH)');
  const priceInput = inspector.getByLabel('Pool price (USDC per WETH)');
  await highInput.fill('3000');
  await priceInput.fill('2850');

  await expect(inspector.getByText('-5% from $3,000 high')).toBeVisible();
  const verdict = inspector.getByRole('status');
  await expect(verdict).toContainText('Skipped');
  await expect(
    canvas.locator('.workflow-node-card[data-matched="true"]', { hasText: 'Do nothing' }),
  ).toBeVisible();

  await priceInput.fill('2700');
  await expect(inspector.getByText('-10% from $3,000 high')).toBeVisible();
  await expect(verdict).toContainText('Would execute');
  await expect(
    canvas.locator('.workflow-node-card[data-matched="true"]', { hasText: 'Sell WETH for USDC' }),
  ).toHaveCount(1);

  await page.screenshot({
    path: testInfo.outputPath('simulator-trailing-stop-desktop.png'),
    animations: 'disabled',
  });

  // Lower per-run WETH cap below 0.05 to verify cap blocking.
  await page.getByRole('button', { name: 'Workflow settings' }).click();
  await inspector.getByLabel('Maximum WETH per run').fill('0.01');
  await inspector.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(verdict).toContainText('Blocked by per-run WETH cap');
});

test('shows a scheduled run as soon as the Test inspector opens', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);

  const recipes = page.getByRole('region', { name: 'Workflow recipes' });
  await recipes.getByRole('button', { name: 'Recurring transfer', exact: false }).click();
  await page.getByLabel('Interval in seconds').fill('3600');
  await page.getByLabel('USDC to send').fill('0.02');
  await page.getByLabel('Recipient address').fill('0x0000000000000000000000000000000000000002');
  await page.getByRole('button', { name: 'Open in builder' }).click();

  const inspector = page.getByRole('complementary', { name: 'Workflow inspector' });
  await inspector.getByRole('button', { name: 'Test', exact: true }).click();
  const verdict = inspector.getByRole('status');
  await expect(verdict).toContainText('Would execute');
  await expect(verdict).toBeInViewport();
  await expect(inspector.getByText('Local preview of one scheduled run.')).toBeVisible();
  await expect(inspector.getByRole('region', { name: 'Scenario', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: /scheduled tick|reset/i })).toHaveCount(0);
  const actions = inspector.getByLabel('Simulated actions');
  await expect(actions).toContainText('0.02 USDC');
  await expect(actions.getByText('0.02 USDC')).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath('simulator-scheduled-mobile.png'),
    animations: 'disabled',
  });
});

for (const viewport of [
  { width: 1440, height: 760, label: 'desktop' },
  { width: 390, height: 844, label: 'mobile' },
]) {
  test(`renders the simulator without layout overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);

    const recipes = page.getByRole('region', { name: 'Workflow recipes' });
    await recipes.getByRole('button', { name: 'Income sweep', exact: false }).click();
    await page.getByLabel('Minimum payment (USDC)').fill('1');
    await page.getByLabel('USDC to send').fill('0.2');
    await page.getByLabel('Recipient address').fill('0x0000000000000000000000000000000000000002');
    await page.getByRole('button', { name: 'Open in builder' }).click();

    const inspector = page.getByRole('complementary', { name: 'Workflow inspector' });
    const testEntry =
      viewport.label === 'desktop'
        ? page.getByRole('region', { name: 'Workflow graph' })
        : inspector;
    const testButton = testEntry.getByRole('button', { name: 'Test', exact: true });
    await testButton.click();
    await expect(testButton).toHaveAttribute('aria-pressed', 'true');
    await expect(inspector.getByRole('heading', { name: 'Test this workflow' })).toBeVisible();
    await expect(inspector.getByRole('status')).toContainText('Would execute');
    await expect(inspector.getByRole('button', { name: /Below floor/ })).toBeInViewport({
      ratio: 0.9,
    });

    expect(
      await page.getByRole('main').evaluate((element) => ({
        workspaceOverflow: element.scrollHeight - element.clientHeight,
        pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
      })),
    ).toEqual({ workspaceOverflow: 0, pageOverflow: 0 });

    await page.screenshot({
      path: testInfo.outputPath(`simulator-${viewport.label}.png`),
      animations: 'disabled',
    });
  });
}
