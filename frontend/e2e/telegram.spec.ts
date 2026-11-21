import { expect, test } from '@playwright/test';
import type { TelegramSettings } from '@rulebook/shared';

import { FIXTURE_FRONTEND_URL } from './fixtureConfig.js';
import { approveSignature, installWallet, skipRuleFunding, walletRequests } from './wallet.js';

test('pairs Telegram and manages alert delivery by keyboard on a narrow viewport', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const owner = '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955';
  await installWallet(page, owner);
  let settings: TelegramSettings = {
    connection: 'disconnected',
    profile: null,
    configured: false,
    enabled: true,
    defaultMode: 'all',
    pendingPairing: null,
    testDelivery: null,
    rules: [{ id: '1', template: 1, preference: 'inherit' }],
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const candidate = { id: 'b'.repeat(64), profile: '@anya' };
  const token = 't'.repeat(43);
  await page.route('**/v1/telegram/availability', (route) =>
    route.fulfill({ json: { available: true } }),
  );
  await page.route('**/v1/accounts/*/telegram**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/challenge')) {
      expect(request.postDataJSON().browser).toBe(true);
      await route.fulfill({
        json: {
          nonce: `0x${'a'.repeat(64)}`,
          expiresAt,
          origin: FIXTURE_FRONTEND_URL,
          proof: 'a'.repeat(64),
          browser: true,
        },
      });
      return;
    }
    if (pathname.endsWith('/session')) {
      expect(request.postDataJSON().signature).toMatch(/^0x[a-f0-9]{130}$/i);
      expect(request.postDataJSON().challenge.browser).toBe(true);
      await route.fulfill({
        json: { verified: true },
        headers: {
          'set-cookie': `rulebook-telegram=${token}; Path=${pathname.slice(0, -'/session'.length)}; Max-Age=34560000; HttpOnly; SameSite=Strict`,
        },
      });
      return;
    }
    if (!(await request.allHeaders()).cookie?.includes(`rulebook-telegram=${token}`)) {
      await route.fulfill({ status: 401, json: {} });
      return;
    }
    if (pathname.endsWith('/pairing')) {
      await route.fulfill({
        json: { url: 'https://t.me/RulebookFixtureBot?start=test', expiresAt },
      });
      return;
    }
    if (pathname.endsWith('/pairing/confirm')) {
      expect(request.postDataJSON().pairingId).toBe(candidate.id);
      settings = {
        ...settings,
        connection: 'connected',
        configured: true,
        profile: candidate.profile,
        pendingPairing: null,
      };
    }
    if (pathname.endsWith('/preferences')) {
      const preference = request.postDataJSON();
      settings =
        'enabled' in preference
          ? { ...settings, enabled: preference.enabled }
          : { ...settings, rules: [{ id: '1', template: 1, preference: preference.preference }] };
    }
    if (pathname.endsWith('/test')) settings = { ...settings, testDelivery: 'sent' };
    await route.fulfill({ json: settings });
  });

  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('button', { name: 'Add REACT' })).toBeVisible({ timeout: 60_000 });
  await skipRuleFunding(page);
  await page.goto('/account');

  const section = page.getByRole('region', { name: 'Telegram notifications' });
  const verify = section.getByRole('button', { name: 'Verify wallet' });
  const transactionsBefore = (await walletRequests(page)).filter(
    ({ method }) => method === 'eth_sendTransaction',
  ).length;
  await verify.focus();
  await page.keyboard.press('Enter');
  const switchPrompt = page.getByRole('dialog', { name: 'Switch to Reactive Lasna' });
  await expect(
    switchPrompt.or(page.getByRole('dialog', { name: 'Review signature on Reactive Lasna' })),
  ).toBeVisible();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: await switchPrompt.isVisible() });
  expect(
    (await walletRequests(page)).filter(({ method }) => method === 'eth_sendTransaction'),
  ).toHaveLength(transactionsBefore);

  const connect = section.getByRole('button', { name: 'Connect Telegram' });
  await connect.focus();
  await page.keyboard.press('Enter');
  await expect(section.getByRole('link', { name: 'Open Telegram bot' })).toHaveAttribute(
    'href',
    'https://t.me/RulebookFixtureBot?start=test',
  );
  settings = { ...settings, pendingPairing: candidate };
  const confirm = section.getByRole('button', { name: 'Connect and enable notifications' });
  await confirm.focus();
  await page.keyboard.press('Enter');
  await expect(section.getByText('Connected to @anya')).toBeVisible();
  await expect(section.getByLabel('Default for rules')).toHaveValue('all');
  await expect(section.getByText('Rule #1 · DCA')).toBeVisible();
  const rule = section.getByLabel('Telegram delivery for rule #1');
  await rule.focus();
  await page.keyboard.press('End');
  await expect(rule).toHaveValue('mute');
  await expect(section.getByText('Muted', { exact: true })).toBeVisible();
  await section.getByLabel('Telegram delivery', { exact: true }).selectOption('false');
  await expect(section.getByText('Delivery off for account')).toBeVisible();
  await section.getByRole('button', { name: 'Send test message' }).click();
  await expect(section.getByText('Test message sent.')).toBeVisible();
  expect(await section.evaluate((panel) => panel.scrollWidth)).toBeLessThanOrEqual(390);
  await section.screenshot({ path: testInfo.outputPath('telegram-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await section.screenshot({ path: testInfo.outputPath('telegram-desktop.png') });
});
