import { randomBytes, randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import {
  emptyDraft,
  rulewrightRequestSchema,
  workflowV2Action,
  workflowV2Unit,
  type RulewrightResult,
  type V2Draft,
} from '@rulebook/shared';

import { DEMO_ADDRESS, FIXTURE_API_URL, FIXTURE_FRONTEND_URL, USER_ADDRESS } from './fixtureConfig';
import { installWallet } from './wallet';

const demoDraft: V2Draft = {
  ...emptyDraft(),
  title: 'Scheduled buy demo',
  interval: '21600',
  usdcCap: '10',
  slippage: '0.5',
  root: {
    steps: [
      { kind: workflowV2Action.buy, unit: workflowV2Unit.fixed, amount: '10', recipient: '' },
    ],
  },
};

async function installDemoAssistantAndRulewright(page: Page) {
  const rwToken = randomBytes(32).toString('base64url');
  const rwJobs = new Map<string, { polls: number; result: RulewrightResult }>();
  const rwHeaders = {
    'access-control-allow-origin': FIXTURE_FRONTEND_URL,
    'access-control-allow-headers': 'authorization,content-type,x-rulewright-origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };

  await page.route(`${FIXTURE_API_URL}/v2/rulewright/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/v2/rulewright', '');
    const send = (json: object, status = 200) =>
      route.fulfill({ status, json, headers: rwHeaders });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: rwHeaders });
    if (path === '/availability') return send({ available: true, demoAvailable: true });
    if (path === '/demo-session') {
      expect(request.postDataJSON()).toEqual({ network: 'testnet' });
      return send({ token: rwToken, expiresAt: Math.floor(Date.now() / 1000) + 1200 });
    }
    expect(request.headers().authorization).toBe(`Bearer ${rwToken}`);
    if (path === '/jobs' && request.method() === 'POST') {
      rulewrightRequestSchema.parse(request.postDataJSON());
      const id = randomUUID();
      rwJobs.set(id, { result: { type: 'draft', draft: demoDraft }, polls: 0 });
      return send({ id }, 202);
    }
    const job = rwJobs.get(path.split('/').at(-1) ?? '');
    if (!job) return send({}, 404);
    return send(job.polls++ ? { status: 'complete', result: job.result } : { status: 'pending' });
  });

  const assistantToken = randomBytes(32).toString('base64url');
  const assistantHeaders = {
    'access-control-allow-origin': FIXTURE_FRONTEND_URL,
    'access-control-allow-headers': 'authorization,content-type,x-assistant-origin',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  };

  await page.route(`${FIXTURE_API_URL}/v2/assistant/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/v2/assistant', '');
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: assistantHeaders });
    }
    if (path === '/availability') {
      return route.fulfill({
        status: 200,
        json: { available: true, demoAvailable: true },
        headers: assistantHeaders,
      });
    }
    if (path === '/demo-session') {
      expect(request.postDataJSON()).toEqual({ network: 'testnet' });
      return route.fulfill({
        status: 200,
        json: { token: assistantToken, owner: DEMO_ADDRESS },
        headers: assistantHeaders,
      });
    }
    if (path === '/chat') {
      expect(request.headers().authorization).toBe(`Bearer ${assistantToken}`);
      const conversationId = randomUUID();
      const events = [
        { type: 'status', label: 'Reading demo workflows' },
        {
          type: 'tool',
          name: 'list_workflows',
          label: 'Reading your workflows',
          state: 'start',
        },
        {
          type: 'tool',
          name: 'list_workflows',
          label: 'Reading your workflows',
          state: 'done',
          detail: '1 workflow',
        },
        {
          type: 'delta',
          text: 'The demo account has 1 active workflow: Income sweep demo on Unichain Sepolia with 25 USDC in its Vault.',
        },
        {
          type: 'done',
          conversationId,
          references: [
            {
              kind: 'account',
              id: 'account',
              label: 'Open Account & Vault',
              href: '/account',
            },
          ],
        },
      ];
      const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
      return route.fulfill({
        status: 200,
        body: sse,
        headers: {
          ...assistantHeaders,
          'content-type': 'text/event-stream; charset=utf-8',
        },
      });
    }
    return route.fulfill({ status: 404, headers: assistantHeaders });
  });
}

test('judges can inspect the live demo account across workspace, proof, Rulewright, and Bookkeeper without a wallet', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await installDemoAssistantAndRulewright(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows`);

  // 1. Enter read-only demo mode from /workflows without a wallet.
  await expect(page.getByText('Connect a wallet to load your workflows')).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Inspect demo account' }).click();

  const banner = page.getByRole('region', { name: 'Demo account mode' });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Demo account · Read-only')).toBeVisible();
  await expect(page.getByRole('link', { name: /Income sweep demo/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({ path: testInfo.outputPath('demo-workflows-desktop.png') });

  // 2. Workflow detail: read-only (no Edit, Pause, or Publish form), live health and weekly budget.
  await page.getByRole('link', { name: /Income sweep demo/ }).click();
  await expect(page.getByRole('heading', { name: 'Income sweep demo', level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Read-only demo')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Workflow health' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly spending budget' })).toBeVisible();
  await expect(page.getByText('10 USDC').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit workflow' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause workflow' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit weekly budget' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish version' })).toHaveCount(0);

  // 3. Activity + Public proof.
  await page.locator('main').getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workflow activity' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole('listitem').getByRole('link', { name: 'Income sweep demo' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Public proof' }).click();
  await expect(page.getByRole('heading', { name: 'Workflow run proof' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('confirmed')).toBeVisible();

  // 4. Account & Vault: live 25 USDC balance, read-only panel instead of Move test funds form.
  await page.getByRole('link', { name: 'Account & Vault' }).click();
  await expect(page.getByRole('heading', { name: 'Account & Vault' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('25', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Read-only demo account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Move test funds' })).toHaveCount(0);

  // 5. Proof lookup: Featured live proofs panel.
  await page.getByRole('link', { name: 'Workflow proof' }).click();
  await expect(page.getByRole('heading', { name: 'Featured live proofs' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Income sweep demo')).toBeVisible();

  // 6. Rulewright without a wallet.
  await page.getByRole('link', { name: 'New workflow' }).click();
  await page.getByRole('button', { name: 'Draft with Rulewright' }).click();
  const rwDialog = page.getByRole('dialog', { name: 'Rulewright' });
  await expect(rwDialog.getByText('Try Rulewright without a wallet')).toBeVisible();
  await rwDialog.getByRole('button', { name: 'Start demo drafting session' }).click();
  await expect(rwDialog.getByText('Demo session')).toBeVisible();
  await rwDialog.getByLabel('Workflow description').fill('Buy 10 USDC of WETH every six hours.');
  await rwDialog.getByRole('button', { name: 'Generate preview' }).click();
  await expect(rwDialog.getByRole('heading', { name: demoDraft.title })).toBeVisible();
  await rwDialog.getByRole('button', { name: 'Apply to canvas' }).click();
  await expect(page.getByLabel('Workflow diagram').getByText('Every 21600 seconds')).toBeVisible();

  // 7. Bookkeeper without a wallet.
  await page.getByRole('button', { name: 'Ask Bookkeeper' }).click();
  const assistantDialog = page.getByRole('dialog', { name: 'Bookkeeper' });
  await expect(assistantDialog.getByText('Ask about the demo account')).toBeVisible();
  await assistantDialog.getByRole('button', { name: 'Start demo session' }).click();
  await expect(assistantDialog.getByText('Demo account', { exact: true })).toBeVisible();
  await assistantDialog
    .getByLabel('Ask Bookkeeper about your account')
    .fill('Which workflows are active?');
  await assistantDialog.getByRole('button', { name: 'Send question' }).click();
  await expect(
    assistantDialog.getByText(
      'The demo account has 1 active workflow: Income sweep demo on Unichain Sepolia with 25 USDC in its Vault.',
    ),
  ).toBeVisible();
  await assistantDialog.getByRole('button', { name: 'Close Bookkeeper' }).click();

  // Mobile layout check and screenshot.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows`);
  await expect(page.getByRole('region', { name: 'Demo account mode' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Income sweep demo/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('demo-workflows-mobile.png') });

  // 8. Connecting a real wallet auto-exits demo mode cleanly.
  await installWallet(page, USER_ADDRESS);
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows`);
  await expect(page.getByRole('region', { name: 'Demo account mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Demo account mode' })).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});
