import { expect, test } from '@playwright/test';

import { FIXTURE_FRONTEND_URL } from './fixtureConfig';

interface ResolvedStyles {
  readonly canvas: string;
  readonly shell: string;
  readonly panel: string;
  readonly primary: string;
  readonly headingFont: string;
  readonly missingTokens: readonly string[];
}

async function resolvedStyles(page: import('@playwright/test').Page): Promise<ResolvedStyles> {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    document.body.append(probe);
    const backgroundColor = (value: string) => {
      probe.style.backgroundColor = value;
      return getComputedStyle(probe).backgroundColor;
    };
    const tokens = [
      '--rb-canvas',
      '--rb-surface-raised',
      '--rb-accent',
      '--rb-danger',
      '--rb-automation',
      '--rb-funds',
      '--rb-radius-panel',
    ];
    const missingTokens = tokens.filter((token) => !root.getPropertyValue(token).trim());
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const panel = document.querySelector<HTMLElement>('.app-panel');
    const primary = document.querySelector<HTMLElement>('.app-button--primary');
    const heading = document.querySelector<HTMLElement>('h1');
    const result = {
      canvas: backgroundColor('var(--rb-canvas)'),
      shell: shell ? getComputedStyle(shell).backgroundColor : '',
      panel: panel ? getComputedStyle(panel).backgroundColor : '',
      primary: primary ? getComputedStyle(primary).backgroundColor : '',
      headingFont: heading ? getComputedStyle(heading).fontFamily : '',
      missingTokens,
    };
    probe.remove();
    return result;
  });
}

test('resolves the core token contract on workspace pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows`);
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

  const styles = await resolvedStyles(page);
  expect(styles.missingTokens).toEqual([]);
  expect(styles.shell).toBe(styles.canvas);
  expect(styles.headingFont).toContain('Manrope');
  expect(styles.primary).not.toBe('rgba(0, 0, 0, 0)');
});

test('uses the shared callout and toolbar recipes on primary routes', async ({ page }) => {
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows`);
  const callout = page.locator('.rb-callout').first();
  await expect(callout).toBeVisible();
  await expect(callout.getByText('Connect a wallet to load your workflows')).toBeVisible();
  await expect(page.locator('.rb-alert')).toHaveCount(0);

  await page.goto(`${FIXTURE_FRONTEND_URL}/marketplace`);
  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(page.locator('main .rb-toolbar')).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeVisible();
});

test('keeps onboarding on the five-step rail at both breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/create`);
  await expect(page.getByRole('heading', { name: 'Connect your wallet' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Account setup progress' }).locator('li'),
  ).toHaveCount(5);
  await expect(page.locator('.account-setup__aside')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('list', { name: 'Account setup progress' })).toBeVisible();
  await expect(page.locator('.account-setup__layout')).toBeVisible();
});

test('captures the key surfaces at desktop and mobile', async ({ page }, testInfo) => {
  const routes = [
    { path: '/workflows', name: 'workflows' },
    { path: '/marketplace', name: 'marketplace' },
    { path: '/create', name: 'create' },
    { path: '/proof', name: 'proof' },
  ];

  for (const viewport of [
    { width: 1440, height: 1000, suffix: 'desktop' },
    { width: 390, height: 844, suffix: 'mobile' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of routes) {
      await page.goto(`${FIXTURE_FRONTEND_URL}${route.path}`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: testInfo.outputPath(`${route.name}-${viewport.suffix}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});
