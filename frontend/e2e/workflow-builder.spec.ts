import { expect, test } from '@playwright/test';

test('uses the wheel to zoom inside the builder canvas and scroll outside it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/workflows/new?template=blank');
  const canvas = page.locator('.workflow-canvas');
  const viewport = canvas.locator('.react-flow__viewport');
  const workspace = page.locator('.app-shell main > [class*="overflow-y-auto"]');
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

  await page.getByRole('heading', { name: 'Build a workflow' }).hover();
  await page.mouse.wheel(0, 280);
  await expect.poll(scrollTop).toBeGreaterThan(initialScroll);
});

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

test('opens the right editor from the canvas nodes and can fit the full diagram', async ({
  page,
}) => {
  await page.goto('/workflows/new?template=payment');
  const canvas = page.locator('.workflow-canvas');
  const settings = page.getByRole('region', { name: 'Selected step settings' });

  const condition = canvas.getByRole('button', { name: 'Condition. Payment is at least 1 USDC' });
  await condition.press('Enter');
  await expect(condition).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByLabel('Payment is at least (USDC)')).toHaveValue('1');
  await canvas.getByText('5% of the payment', { exact: true }).click();
  await expect(settings.getByRole('heading', { name: 'Path steps' })).toBeVisible();

  const readout = canvas.locator('.workflow-canvas-zoom');
  const initialZoom = await readout.textContent();
  await canvas.getByRole('button', { name: /zoom in/i }).click();
  await expect(readout).not.toHaveText(initialZoom ?? '');
  await canvas.getByRole('button', { name: /fit view/i }).click();
  await expect(readout).toHaveText(initialZoom ?? '');
});

test('keeps the canvas readable and opens the settings on a small desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/workflows/new?template=payment');
  const canvas = page.locator('.workflow-canvas');
  const settings = page.getByRole('region', { name: 'Selected step settings' });

  await expect.poll(() => canvas.evaluate((element) => element.clientWidth)).toBeGreaterThan(550);
  await canvas.getByRole('button', { name: 'Condition. Payment is at least 1 USDC' }).click();
  await expect(settings).toBeFocused();
  await expect(settings.getByLabel('Payment is at least (USDC)')).toHaveValue('1');
});

test('drags one node with its connections and saves its position in the draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('/workflows/new?template=payment');
  const canvas = page.locator('.workflow-canvas');
  const transfer = canvas.getByRole('button', { name: /^Step 1\. Send USDC\. Send 20%/ });
  const nextStep = canvas.locator('.workflow-node[data-id="root-yes-step-1"]');
  const edge = canvas
    .getByTestId('rf__edge-root-yes-root-yes-step-1')
    .locator('.react-flow__edge-path');
  const horizontalPosition = (node: typeof transfer) =>
    node.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).e);

  await transfer.click();
  await expect(transfer).toHaveAttribute('aria-pressed', 'true');
  const before = await horizontalPosition(transfer);
  const nextPosition = await horizontalPosition(nextStep);
  const edgeBefore = await edge.getAttribute('d');
  const box = await transfer.boundingBox();
  if (!box) throw new Error('The transfer node is out of view.');

  await expect(canvas.locator('.workflow-node[style*="visibility: hidden"]')).toHaveCount(0);
  const visibility = await canvas.evaluateHandle((element) => {
    let hidden = 0;
    function track(records: MutationRecord[]) {
      for (const record of records) {
        const node = record.target;
        if (
          node instanceof HTMLElement &&
          node.classList.contains('workflow-node') &&
          (node.style.visibility === 'hidden' || record.oldValue?.includes('visibility: hidden'))
        )
          hidden++;
      }
    }
    const observer = new MutationObserver(track);
    observer.observe(element, {
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true,
    });
    return () => {
      track(observer.takeRecords());
      observer.disconnect();
      return hidden;
    };
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 72, box.y + box.height / 2 + 18, { steps: 6 });
  await expect.poll(() => horizontalPosition(transfer)).toBeGreaterThan(before + 50);
  await expect(edge).not.toHaveAttribute('d', edgeBefore ?? '');
  expect(await horizontalPosition(nextStep)).toBe(nextPosition);
  await page.mouse.up();
  const moved = await horizontalPosition(transfer);
  expect(await visibility.evaluate((stop) => stop())).toBe(0);

  await page.reload();
  await expect.poll(() => horizontalPosition(transfer)).toBeCloseTo(moved);
  expect(await horizontalPosition(nextStep)).toBe(nextPosition);
});

test('a phone can edit conditions through the outline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workflows/new?template=payment');
  await page.getByRole('button', { name: 'Payment is at least 1 USDC' }).click();
  await page.getByLabel('Payment is at least (USDC)').fill('2');
  await expect(page.getByRole('button', { name: 'Payment is at least 2 USDC' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show outline' })).toBeHidden();
});
