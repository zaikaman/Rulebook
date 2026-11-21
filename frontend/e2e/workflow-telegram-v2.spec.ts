import { expect, test } from '@playwright/test';
import type { TelegramPreference, TelegramSettings } from '@rulebook/shared';

import { FIXTURE_V2_FRONTEND_URL, USER_ADDRESS } from './fixtureConfig';
import { approveSignature, installWallet, walletRequests } from './wallet';

const OWNER = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';
const title = 'Recurring transfer';

test('pairs Telegram in Account & Vault and controls delivery from a workflow', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await installWallet(page, OWNER);

  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const pairing = { id: 'a'.repeat(64), profile: '@anya' };
  const botUrl = 'https://t.me/RulebookFixtureBot?start=test';
  const token = 't'.repeat(43);
  let verifications = 0;
  let settings: TelegramSettings = {
    connection: 'disconnected',
    profile: null,
    configured: false,
    enabled: true,
    defaultMode: 'all',
    fundingAlerts: true,
    actionAlerts: true,
    pendingPairing: null,
    testDelivery: null,
    rules: [],
    workflows: [],
  };
  await page.context().route(
    (url) => url.pathname === '/v1/telegram/availability',
    async (route) => {
      expect(new URL(route.request().url()).searchParams.get('workflow')).toBe('true');
      await route.fulfill({ json: { available: true } });
    },
  );
  await page.context().route('**/v1/accounts/*/telegram**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    expect(new URL(request.url()).origin).toBe(FIXTURE_V2_FRONTEND_URL);
    if (path.endsWith('/challenge')) {
      expect(request.postDataJSON().browser).toBe(true);
      await route.fulfill({
        json: {
          nonce: `0x${'b'.repeat(64)}`,
          expiresAt,
          origin: FIXTURE_V2_FRONTEND_URL,
          proof: 'b'.repeat(64),
          browser: true,
        },
      });
      return;
    }
    if (path.endsWith('/session')) {
      const cookiePath = path.slice(0, -'/session'.length);
      if (request.method() === 'DELETE') {
        await route.fulfill({
          json: { forgotten: true },
          headers: { 'set-cookie': `rulebook-telegram=; Path=${cookiePath}; Max-Age=0; HttpOnly` },
        });
        return;
      }
      verifications += 1;
      expect(request.postDataJSON().signature).toMatch(/^0x[a-f0-9]{130}$/i);
      expect(request.postDataJSON().challenge.browser).toBe(true);
      await route.fulfill({
        json: { verified: true },
        headers: {
          'set-cookie': `rulebook-telegram=${token}; Path=${cookiePath}; Max-Age=34560000; HttpOnly; SameSite=Strict`,
        },
      });
      return;
    }
    if (!(await request.allHeaders()).cookie?.includes(`rulebook-telegram=${token}`)) {
      await route.fulfill({ status: 401, json: {} });
      return;
    }
    if (path.endsWith('/pairing')) {
      await route.fulfill({ json: { url: botUrl, expiresAt } });
      return;
    }
    if (path.endsWith('/pairing/confirm')) {
      expect(request.postDataJSON()).toEqual({ pairingId: pairing.id });
      settings = {
        ...settings,
        connection: 'connected',
        configured: true,
        profile: pairing.profile,
      };
    }
    if (path.endsWith('/preferences')) {
      const body = request.postDataJSON() as
        { workflowId: string; preference: TelegramPreference } | { actionAlerts: boolean };
      if ('actionAlerts' in body) {
        settings = { ...settings, actionAlerts: body.actionAlerts };
      } else {
        const workflowId = settings.workflows![0]!.id;
        expect(body).toEqual({ workflowId, preference: 'mute' });
        settings = {
          ...settings,
          workflows: [{ id: workflowId, title, preference: body.preference }],
        };
      }
    }
    if (path.endsWith('/test')) settings = { ...settings, testDelivery: 'sent' };
    await route.fulfill({ json: settings });
  });

  await page.goto(FIXTURE_V2_FRONTEND_URL + '/create');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByRole('button', { name: 'Build a workflow and fund later' }).click();
  await page.getByRole('button', { name: title, exact: false }).click();
  await page.getByLabel('Interval in seconds').fill('3600');
  await page.getByLabel('USDC to send').fill('0.02');
  await page.getByLabel('Recipient address').fill(USER_ADDRESS);
  await page.getByRole('button', { name: 'Open in builder' }).click();
  await page.getByRole('button', { name: 'Review workflow' }).click();
  await page.getByRole('button', { name: 'Activate workflow' }).click();
  await approveSignature(page, 'Unichain Sepolia', { switchNetwork: true });
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await expect(page.getByRole('link', { name: 'Edit workflow' })).toBeVisible();
  const workflowId = new URL(page.url()).pathname.split('/').at(-1) as `0x${string}`;
  settings = { ...settings, workflows: [{ id: workflowId, title, preference: 'inherit' }] };

  const section = page.getByRole('region', { name: 'Telegram notifications' });
  await expect(section.getByRole('button', { name: 'Verify wallet' })).toBeVisible();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  const beforeVerification = await walletRequests(page);
  await section.getByRole('button', { name: 'Verify wallet' }).click();
  await approveSignature(page, 'Reactive Lasna');
  const requests = (await walletRequests(page)).slice(beforeVerification.length);
  expect(requests.map(({ method }) => method)).toEqual(['eth_signTypedData_v4']);
  await section.getByRole('button', { name: 'Connect Telegram', exact: true }).click();
  await expect(section.getByRole('link', { name: 'Open Telegram bot' })).toHaveAttribute(
    'href',
    botUrl,
  );
  settings = { ...settings, pendingPairing: pairing };
  await section.getByRole('button', { name: 'Connect and enable notifications' }).click();
  await expect(section.getByText('Connected to @anya')).toBeVisible();
  await expect(section.getByLabel('Default for workflow updates')).toHaveValue('all');
  await expect(section.getByLabel('Funding alerts')).toHaveValue('true');
  const actionAlerts = section.getByLabel('Action needed');
  await expect(actionAlerts).toHaveValue('true');
  await actionAlerts.selectOption('false');
  await expect(actionAlerts).toHaveValue('false');
  await expect(section.getByLabel('Funding alerts')).toHaveValue('true');
  await expect(section.getByLabel('Default for workflow updates')).toHaveValue('all');
  await section.getByRole('button', { name: 'Send test message' }).click();
  await expect(section.getByText('Test message sent.')).toBeVisible();

  await page.reload();
  await expect(section.getByText('Connected to @anya')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Verify wallet' })).toHaveCount(0);
  expect(verifications).toBe(1);
  const cookie = (await page.context().cookies()).find(({ name }) => name === 'rulebook-telegram');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000);

  const newTab = await page.context().newPage();
  await installWallet(newTab, OWNER);
  await newTab.goto(FIXTURE_V2_FRONTEND_URL + '/account');
  const reopened = newTab.getByRole('region', { name: 'Telegram notifications' });
  await expect(reopened.getByText('Connected to @anya')).toBeVisible();
  expect(verifications).toBe(1);
  await newTab.close();

  await page.goBack();
  const delivery = section.getByLabel(`Telegram delivery for ${title}`);
  await delivery.selectOption('mute');
  await expect(section.getByText('Muted', { exact: true })).toBeVisible();
  expect(await section.evaluate((panel) => panel.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await section.getByRole('button', { name: 'Forget this browser' }).click();
  await expect(section.getByRole('button', { name: 'Verify wallet' })).toBeVisible();
  await page.reload();
  await expect(section.getByRole('button', { name: 'Verify wallet' })).toBeVisible();
  expect((await page.context().cookies()).some(({ name }) => name === 'rulebook-telegram')).toBe(
    false,
  );
});
