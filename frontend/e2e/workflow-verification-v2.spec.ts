import {
  getChain,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowV2Action,
  workflowV2Check,
  workflowV2Recipes,
  workflowV2Trigger,
} from '@rulebook/shared';
import { expect, test, type Page } from '@playwright/test';
import { toFunctionSelector } from 'viem';

import {
  actions,
  checks,
  recipeFields,
  recipeLabels,
  triggers,
  type CheckCode,
  type TriggerCode,
} from '../src/workflows/modelV2';
import { FIXTURE_FRONTEND_URL, USER_ADDRESS } from './fixtureConfig';
import {
  approveSignature,
  fundFixtureWorkflowVault,
  installWallet,
  walletRequests,
} from './wallet';

const builder = process.env.RULEBOOK_E2E_LIVE_APP ?? FIXTURE_FRONTEND_URL;
const mobile = process.env.RULEBOOK_E2E_MOBILE === 'true';
const trigger = workflowV2Trigger;
const check = workflowV2Check;
const action = workflowV2Action;
const token = getChain(UNICHAIN_SEPOLIA_CHAIN_ID).usdc;
test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 940 } });

const parameters: Record<string, string> = {
  intervalSeconds: '3600',
  buyUsdc: '0.02',
  sellWeth: '0.00001',
  slippagePercent: '1',
  dipPercent: '5',
  limitPrice: '1500',
  targetPrice: '1800',
  stopPrice: '1300',
  trailPercent: '8',
  bandPercent: '3',
  referencePrice: '1500',
  recipient: USER_ADDRESS,
  sendUsdc: '0.02',
  minimumPaymentUsdc: '0.10',
  smallPaymentUsdc: '0.05',
  smallSweepUsdc: '0.01',
  floorUsdc: '0.40',
  refillUsdc: '0.10',
  inactivitySeconds: '86400',
  lowerPrice: '1000',
  upperPrice: '3000',
  token,
  watchedWallet: USER_ADDRESS,
  minimumTransferRaw: '1000',
};

/** Library nodes render a suffix such as "Adds a condition", so match the name as a prefix. */
function nodeName(name: string) {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
}

function library(page: Page) {
  return page.getByRole('complementary', { name: 'Workflow inspector' });
}

async function openLibraryGroup(page: Page, group: string) {
  await library(page).getByRole('button', { name: 'Library', exact: true }).click();
  await library(page).getByRole('button', { name: group, exact: true }).click();
}

async function pickNode(page: Page, group: string, name: string) {
  await openLibraryGroup(page, group);
  await library(page)
    .getByRole('button', { name: nodeName(name) })
    .click();
}

async function chooseTrigger(page: Page, kind: TriggerCode) {
  await pickNode(page, 'Triggers', triggers[kind]);
  await library(page)
    .getByRole('button', { name: /^Use as trigger/ })
    .click();
}

async function placeNode(page: Page, path: 'Main' | 'Yes' | 'Otherwise' = 'Main') {
  await library(page)
    .getByRole('button', { name: nodeName(path + ' path') })
    .click();
}

async function fromScratch(page: Page, name: string) {
  await page.goto(builder + '/workflows/new');
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await page.getByLabel('Workflow name').fill(name);
  await page
    .getByLabel('Workflow diagram')
    .getByRole('button', { name: /^Trigger\./ })
    .click();
}

async function addAlert(page: Page, path?: 'Yes' | 'Otherwise') {
  await pickNode(page, 'Notifications', actions[action.alert].name);
  await placeNode(page, path);
}

async function expectReview(page: Page, name: string) {
  await page.getByRole('button', { name: 'Review workflow' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  const review = page.locator('.rb-review-program');
  await expect(review.getByRole('heading', { name: 'Program review' })).toBeVisible();
  const settlement = review.locator('dl > div').filter({ hasText: 'Settlement network' });
  await expect(settlement.locator('dd')).toHaveText('Unichain Sepolia');
}

for (const recipe of workflowV2Recipes) {
  test(`builds and restores the ${recipe.title} recipe draft`, async ({ page }) => {
    await page.goto(builder + '/workflows/new');
    const picker = page.getByRole('region', { name: 'Workflow recipes' });
    const settings = page.locator('.rb-configurator');
    await picker
      .getByRole('group', { name: 'Recipe category' })
      .getByRole('button', { name: recipe.category, exact: true })
      .click();
    await picker.getByLabel('Search recipes').fill(recipe.title);
    await picker.getByRole('button', { name: recipe.title, exact: false }).click();
    for (const field of recipeFields[recipe.id]) {
      const value =
        field === 'expiresAt' ? String(Math.floor(Date.now() / 1000) + 3600) : parameters[field];
      if (field === 'direction') {
        await settings.getByLabel('Alert when the price is').selectOption('falling');
      } else {
        expect(value, field).toBeTruthy();
        await settings.getByLabel(recipeLabels[field]!, { exact: true }).fill(value!);
      }
    }
    if (recipe.id === 'inactivity-payout') {
      await settings.getByRole('button', { name: 'Open in builder' }).click();
      await expect(settings.getByRole('alert')).toContainText(
        'Confirm the fixed inactivity payout',
      );
      await settings.getByRole('checkbox').check();
    }
    await settings.getByRole('button', { name: 'Open in builder' }).click();
    await expect(page.getByLabel('Workflow name')).toHaveValue(recipe.title);
    const editedTitle = recipe.title + ' draft';
    await page.getByLabel('Workflow name').fill(editedTitle);
    await expectReview(page, editedTitle);
    const summary = page.locator('.rb-review-program');
    const reviewed = await summary.innerText();
    await page.reload();
    await expect(page.getByLabel('Workflow name')).toHaveValue(editedTitle);
    await expectReview(page, editedTitle);
    await expect.poll(() => summary.innerText()).toBe(reviewed);
  });
}

const compatibleTriggers: Partial<Record<CheckCode, TriggerCode>> = {
  [check.amountAtLeast]: trigger.payment,
  [check.amountAbove]: trigger.transfer,
  [check.paymentFrom]: trigger.payment,
  [check.trailing]: trigger.price,
  [check.aboveReference]: trigger.price,
  [check.belowReference]: trigger.price,
  [check.priceRisesThrough]: trigger.price,
  [check.priceFallsThrough]: trigger.price,
};

for (const kind of Object.values(check)) {
  const metadata = checks[kind];
  test(`places and configures the ${metadata.name} check`, async ({ page }) => {
    const name = 'Branch with ' + metadata.name;
    await fromScratch(page, name);
    const kindOfTrigger = compatibleTriggers[kind] ?? trigger.schedule;
    if (kindOfTrigger !== trigger.schedule) {
      await openLibraryGroup(page, 'Checks');
      const needsTrigger = library(page).getByRole('button', { name: nodeName(metadata.name) });
      await expect(needsTrigger).toBeDisabled();
      await chooseTrigger(page, kindOfTrigger);
    } else {
      await page.getByLabel('Interval in seconds').fill('3600');
    }
    if (kindOfTrigger === trigger.transfer)
      await page.getByLabel('Token contract address').fill(token);
    if (kind === check.paymentFrom) {
      await page.getByText('Live check settings', { exact: true }).click();
      await page.getByLabel('Watched wallet address').fill(USER_ADDRESS);
    }
    await pickNode(page, 'Checks', metadata.name);
    await placeNode(page);
    if (metadata.decimals !== undefined) {
      const threshold =
        kind === check.inactivity ? '86400' : metadata.decimals === 18 ? '1200' : '2';
      await page.getByLabel(`${metadata.name} threshold`, { exact: true }).fill(threshold);
    }
    if (metadata.upper) await page.getByLabel(metadata.upper, { exact: true }).fill('2400');
    await addAlert(page, 'Otherwise');
    const canvas = page.getByLabel('Workflow diagram');
    await expect(canvas.getByText(metadata.name, { exact: false })).toBeVisible();
    await expect(canvas.getByText('Record an alert', { exact: true })).toBeVisible();
    await expect(canvas.getByText('Do nothing', { exact: true })).toBeVisible();
    await expectReview(page, name);
  });
}

for (const [kind, name] of Object.entries(triggers) as [string, string][]) {
  test(`places and reviews the ${name} trigger`, async ({ page }) => {
    const id = Number(kind) as TriggerCode;
    const title = 'Verify ' + name;
    await fromScratch(page, title);
    if (id === trigger.schedule) {
      await page.getByLabel('Interval in seconds').fill('3600');
    } else {
      await chooseTrigger(page, id);
      if (id === trigger.transfer) await page.getByLabel('Token contract address').fill(token);
      if (id === trigger.payment)
        await page.getByText('Live check settings', { exact: true }).click();
      if (id === trigger.payment)
        await page.getByLabel('Watched wallet address').fill(USER_ADDRESS);
    }
    await addAlert(page);
    await expectReview(page, title);
    await expect(page.locator('.rb-review-program')).toContainText(name);
  });
}

for (const kind of Object.values(action)) {
  const metadata = actions[kind];
  test(`configures and reviews the ${metadata.name} action`, async ({ page }) => {
    const name = 'Verify ' + metadata.name;
    await fromScratch(page, name);
    await page.getByLabel('Interval in seconds').fill('3600');
    const parent =
      kind === action.refill
        ? check.usdcBelow
        : kind === action.inactivityPayout
          ? check.inactivity
          : null;
    if (parent !== null) {
      const meta = checks[parent];
      await pickNode(page, 'Checks', meta.name);
      await placeNode(page);
      await page
        .getByLabel(meta.name + ' threshold')
        .fill(parent === check.inactivity ? '86400' : '1');
    }
    await pickNode(page, kind === action.alert ? 'Notifications' : 'Actions', metadata.name);
    await placeNode(page, parent === null ? 'Main' : 'Yes');
    if (metadata.asset)
      await library(page)
        .getByLabel('Amount in ' + metadata.asset)
        .fill(metadata.asset === 'USDC' ? '0.2' : '0.0001');
    if (metadata.recipient) await library(page).getByLabel('Recipient address').fill(USER_ADDRESS);
    if (metadata.asset) {
      await page.getByRole('button', { name: 'Workflow settings' }).click();
      await page.getByLabel('Maximum USDC per run').fill('0.2');
      await page.getByLabel('Maximum WETH per run').fill('0.0001');
      if (kind === action.buy || kind === action.sell)
        await page.getByLabel('Maximum swap slippage (%)').fill('1');
      if (kind === action.inactivityPayout)
        await page.getByRole('checkbox', { name: 'Close after a confirmed run' }).check();
    }
    await expect(
      page.getByLabel('Workflow diagram').getByText(metadata.name, { exact: true }),
    ).toBeVisible();
    await expectReview(page, name);
  });
}

test('rejects drops on the wrong node and preserves a full branch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await fromScratch(page, 'Verify canvas connections');
  await page.getByLabel('Interval in seconds').fill('3600');
  const canvas = page.getByLabel('Workflow diagram');
  const schedule = canvas.getByRole('button', { name: 'Trigger. Every 3600 seconds' });
  const skip = canvas.getByRole('button', { name: 'Skip. Do nothing' });
  await openLibraryGroup(page, 'Triggers');
  const price = library(page).getByRole('button', { name: nodeName(triggers[trigger.price]) });
  await price.dragTo(skip);
  await expect(schedule).toBeVisible();
  await price.dragTo(schedule);
  await expect(canvas.getByRole('button', { name: 'Trigger. Pool price changes' })).toBeVisible();

  await chooseTrigger(page, trigger.schedule);
  for (let count = 1; count <= 3; count++) {
    await addAlert(page);
    await expect(canvas.getByText('Record an alert', { exact: true })).toHaveCount(count);
  }
  await pickNode(page, 'Notifications', actions[action.alert].name);
  await expect(
    library(page).getByText('No path can accept this node.', { exact: false }),
  ).toBeVisible();
  await expect(canvas.getByText('Record an alert', { exact: true })).toHaveCount(3);
  await expectReview(page, 'Verify canvas connections');
});

test('resumes activation after the wallet declines the Lasna signature', async ({ page }) => {
  test.skip(Boolean(process.env.RULEBOOK_E2E_LIVE_APP), 'Requires the local test wallet');
  test.setTimeout(120_000);
  await installWallet(page, USER_ADDRESS, UNICHAIN_SEPOLIA_CHAIN_ID, {
    rejectFirstCall: toFunctionSelector('enable(bytes32,uint64,bytes,string,uint64)'),
  });
  await page.goto(builder + '/workflows/new');
  await page.getByRole('button', { name: 'Recurring transfer', exact: false }).click();
  await page.getByLabel('Interval in seconds').fill('3600');
  await page.getByLabel('USDC to send').fill('0.02');
  await page.getByLabel('Recipient address').fill(USER_ADDRESS);
  await page.getByRole('button', { name: 'Open in builder' }).click();
  await expectReview(page, 'Recurring transfer');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  await page.getByRole('button', { name: 'Activate workflow' }).click();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await approveSignature(page, 'Unichain Sepolia', { switchNetwork: true });
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await approveSignature(page, 'Unichain Sepolia', { switchNetwork: true });
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await expect(page.getByRole('alert')).toContainText(/declined|rejected/i);
  await fundFixtureWorkflowVault(USER_ADDRESS, 10_000_000n);

  await page.getByRole('button', { name: 'Activate workflow' }).click();
  await approveSignature(page, 'Reactive Lasna');
  await expect(
    page.getByRole('heading', { name: 'Recurring transfer', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.rb-chip[data-tone="active"]')).toHaveText('Active');
  const sent = (await walletRequests(page))
    .filter(({ method }) => method === 'eth_sendTransaction')
    .map(({ chainId }) => chainId);
  expect(sent).toEqual([5_318_007, 1301, 5_318_007, 1301, 5_318_007, 5_318_007]);
});
