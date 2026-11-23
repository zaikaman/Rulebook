import { randomBytes, randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import {
  emptyDraft,
  rulewrightChallengeSchema,
  rulewrightRequestSchema,
  rulewrightSignIn,
  workflowV2Action,
  workflowV2Unit,
  type RulewrightResult,
  type V2Draft,
} from '@rulebook/shared';
import { verifyMessage } from 'viem';

import { FIXTURE_API_URL, FIXTURE_FRONTEND_URL, USER_ADDRESS } from './fixtureConfig';
import { installWallet, walletRequests } from './wallet';

const buy: V2Draft = {
  ...emptyDraft(),
  title: 'Scheduled buy',
  interval: '21600',
  usdcCap: '10',
  slippage: '0.5',
  root: {
    steps: [
      { kind: workflowV2Action.buy, unit: workflowV2Unit.fixed, amount: '10', recipient: '' },
    ],
  },
};
const description = 'Buy 10 USDC of WETH every six hours with a cap of 10 USDC.';
const question = 'What maximum swap slippage should each run allow?';

async function installRulewrightResponses(page: Page) {
  const challenge = rulewrightChallengeSchema.parse({
    owner: USER_ADDRESS,
    origin: FIXTURE_FRONTEND_URL,
    nonce: `0x${randomBytes(32).toString('hex')}`,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
  });
  const token = randomBytes(32).toString('base64url');
  const jobs = new Map<string, { polls: number; result: RulewrightResult }>();
  const headers = {
    'access-control-allow-origin': FIXTURE_FRONTEND_URL,
    'access-control-allow-headers': 'authorization,content-type,x-rulewright-origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
  await page.route(`${FIXTURE_API_URL}/v2/rulewright/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/v2/rulewright', '');
    async function send(json: object, status = 200) {
      await route.fulfill({ status, json, headers });
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/availability') return send({ available: true });
    if (path === '/challenge') return send(challenge);
    if (path === '/session') {
      const { nonce, signature } = request.postDataJSON();
      expect(nonce).toBe(challenge.nonce);
      expect(
        await verifyMessage({
          address: challenge.owner,
          message: rulewrightSignIn(challenge),
          signature,
        }),
      ).toBe(true);
      return send({ token, expiresAt: challenge.expiresAt + 900 });
    }
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    if (path === '/jobs' && request.method() === 'POST') {
      const input = rulewrightRequestSchema.parse(request.postDataJSON());
      let result: RulewrightResult = { type: 'question', message: question };
      if (input.draft) {
        expect(input.draft).toEqual(buy);
        result = { type: 'draft', draft: { ...input.draft, interval: '86400' } };
      } else if (input.followUps.length) {
        expect(input.followUps).toEqual([{ question, answer: '0.5%' }]);
        result = { type: 'draft', draft: buy };
      }
      const id = randomUUID();
      jobs.set(id, { result, polls: 0 });
      return send({ id }, 202);
    }
    const job = jobs.get(path.split('/').at(-1) ?? '');
    if (!job) return send({}, 404);
    return send(job.polls++ ? { status: 'complete', result: job.result } : { status: 'pending' });
  });
}

test('verifies a wallet and applies polled previews after clarification or an edit', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installWallet(page);
  await installRulewrightResponses(page);
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);

  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Draft with Rulewright' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rulewright' });
  await dialog.getByRole('button', { name: 'Verify wallet' }).click();
  await dialog.getByLabel('Workflow description').fill(description);
  await dialog.getByRole('button', { name: 'Generate preview' }).click();
  await expect(dialog.getByText('Rulewright is drafting your workflow…')).toBeVisible();
  await expect(dialog.getByText(question)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply to canvas' })).toHaveCount(0);
  await dialog.getByLabel('Your answer').fill('0.5%');
  await dialog.getByRole('button', { name: 'Generate preview' }).click();
  await expect(dialog.getByRole('heading', { name: buy.title })).toBeVisible();
  await expect(dialog.getByText('10 USDC · 0 WETH')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('rulewright-desktop.png') });
  await dialog.getByRole('button', { name: 'Apply to canvas' }).click();
  const canvas = page.getByLabel('Workflow diagram');
  await expect(canvas.getByText('Every 21600 seconds')).toBeVisible();
  await expect(canvas.getByText('Buy WETH with USDC')).toBeVisible();

  const opener = page.getByRole('button', { name: 'Ask Rulewright' });
  await opener.click();
  await dialog.getByLabel('Workflow description').fill('Change the schedule to once a day.');
  await dialog.getByRole('button', { name: 'Generate preview' }).click();
  await expect(dialog.getByRole('heading', { name: 'Proposed changes' })).toBeVisible();
  await expect(dialog.getByText('21600 seconds', { exact: false })).toBeVisible();
  await expect(dialog.getByText('86400 seconds', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply to canvas' }).click();
  await expect(canvas.getByText('Every 86400 seconds')).toBeVisible();
  await expect(canvas.getByText('Buy WETH with USDC')).toBeVisible();
  await expect(opener).toBeFocused();
  expect((await walletRequests(page)).map(({ method }) => method)).toEqual(['personal_sign']);
});

test('fits the Rulewright dialog on a phone and restores keyboard focus on close', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRulewrightResponses(page);
  await page.goto(`${FIXTURE_FRONTEND_URL}/workflows/new`);
  const opener = page.getByRole('button', { name: 'Draft with Rulewright' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Rulewright' });
  await expect(
    dialog.getByText('Connect your wallet from the workspace header', { exact: false }),
  ).toBeVisible();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('rulewright-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
