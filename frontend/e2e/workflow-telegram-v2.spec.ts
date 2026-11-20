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
  let settings: TelegramSettings = {
    connection: 'disconnected',
    profile: null,
    configured: false,
    enabled: true,
    defaultMode: 'all',
    pendingPairing: null,
    testDelivery: null,
    rules: [],
    workflows: [],
  };
  await page.route(
    (url) => url.pathname === '/v1/telegram/availability',
    async (route) => {
      expect(new URL(route.request().url()).searchParams.get('workflow')).toBe('true');
      await route.fulfill({ json: { available: true } });
    },
  );
  await page.route('**/v1/accounts/*/telegram**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/challenge')) {
      await route.fulfill({
        json: {
          nonce: `0x${'b'.repeat(64)}`,
          expiresAt,
          origin: FIXTURE_V2_FRONTEND_URL,
          proof: 'b'.repeat(64),
        },
      });
      return;
    }
    if (path.endsWith('/session')) {
      expect(request.postDataJSON().signature).toMatch(/^0x[a-f0-9]{130}$/i);
      await route.fulfill({ json: { token, expiresAt } });
      return;
    }
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
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
      const body = request.postDataJSON() as { workflowId: string; preference: TelegramPreference };
      const workflowId = settings.workflows![0]!.id;
      expect(body).toEqual({ workflowId, preference: 'mute' });
      settings = {
        ...settings,
        workflows: [{ id: workflowId, title, preference: body.preference }],
      };
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
  await expect(section.getByLabel('Default for workflows')).toHaveValue('all');
  await section.getByRole('button', { name: 'Send test message' }).click();
  await expect(section.getByText('Test message sent.')).toBeVisible();

  await page.goBack();
  const delivery = section.getByLabel(`Telegram delivery for ${title}`);
  await delivery.selectOption('mute');
  await expect(section.getByText('Muted', { exact: true })).toBeVisible();
  expect(await section.evaluate((panel) => panel.scrollWidth)).toBeLessThanOrEqual(390);
});
