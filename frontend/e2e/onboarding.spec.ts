import { expect, test } from '@playwright/test';
import { getChain, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import {
  createTestClient,
  http,
  numberToHex,
  publicActions,
  toFunctionSelector,
  zeroHash,
} from 'viem';

import { ANVIL_RPC_URL, USER_ADDRESS, VAULT_FACTORY_ADDRESS } from './fixtureConfig.js';
import { approveSignature, installWallet, walletRequests } from './wallet.js';

test('keeps wallet connection options visible on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/create');
  await page.getByRole('button', { name: 'Connect wallet to start' }).click();
  const chooser = page.getByRole('dialog', { name: 'Connect wallet' });
  await expect(chooser).toBeInViewport({ ratio: 1 });
  await expect(chooser.getByRole('link', { name: 'Get Rainbow' })).toBeInViewport({ ratio: 1 });
});

test('guides a new wallet through setup and self-funding from the composer', async ({ page }) => {
  test.setTimeout(240_000);
  await installWallet(page, undefined, undefined, {
    blockFirstTypedSignature: true,
    rejectFirstCall: toFunctionSelector('linkVault(uint256,address)'),
  });
  await page.goto('/create');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect your wallet' })).toBeVisible();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Get Lasna REACT' })).toHaveCount(0);

  const chain = createTestClient({ mode: 'anvil', transport: http(ANVIL_RPC_URL) }).extend(
    publicActions,
  );
  const balance = await chain.getBalance({ address: USER_ADDRESS });
  const createAccount = page.getByRole('button', { name: 'Create my account' });
  await chain.setBalance({ address: USER_ADDRESS, value: 0n });
  try {
    await page.getByRole('button', { name: 'Connect wallet to start' }).click();
    await expect(page.getByRole('heading', { name: 'Get test tokens', exact: true })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Set up test networks' })).toBeHidden();
    await expect(page.getByText('Step 3 of 5')).toBeVisible();
    expect(await walletRequests(page)).toEqual([]);
    await expect(page.getByRole('link', { name: 'Get Lasna REACT' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get Unichain Sepolia ETH' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get Unichain Sepolia USDC' })).toBeVisible();
    const tokens = page.getByRole('list', { name: 'Wallet token balances' });
    for (const symbol of ['REACT', 'ETH']) {
      const row = tokens
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: `Test ${symbol}` }) });
      await expect(row.getByText('Missing')).toBeVisible();
      await expect(row.getByText(new RegExp(`Estimated minimum 0\\.\\d+ ${symbol}`))).toBeVisible();
    }
    await expect(tokens.getByText('Required for setup 0 USDC')).toBeVisible();
    await expect(page.getByText('Get test REACT and test ETH to continue.')).toBeVisible();
    await expect(createAccount).toHaveCount(0);

    await chain.setBalance({ address: USER_ADDRESS, value: 1n });
    await page.getByRole('button', { name: 'Check balances' }).click();
    await expect(tokens.getByText('Top up recommended')).toHaveCount(2);
    await expect(tokens.getByText(/Add 0\.\d+ (ETH|REACT) more/)).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Continue to account setup' })).toBeEnabled();
    await expect(createAccount).toHaveCount(0);
  } finally {
    await chain.setBalance({ address: USER_ADDRESS, value: balance });
  }
  await page.getByRole('button', { name: 'Check balances' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeFocused();
  await expect(page.getByRole('list', { name: 'Wallet token balances' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review test tokens' }).click();
  await expect(page.getByRole('heading', { name: 'Get test tokens' })).toBeFocused();
  await page.getByRole('button', { name: 'Continue to account setup' }).click();
  await expect(createAccount).toBeEnabled();
  const review = page.getByRole('region', { name: 'Wallet steps' });
  await expect(review.getByRole('listitem')).toHaveCount(3);
  await createAccount.click();
  const denied = page.getByRole('alert').filter({ hasText: 'Your wallet denied access' });
  await expect(denied.getByText('Unichain Sepolia')).toBeVisible();
  const requestsBeforeRefresh = await walletRequests(page);
  await denied.getByRole('button', { name: 'Refresh wallet access' }).click();
  await expect(page.getByText(/Wallet access refreshed/)).toBeVisible();
  expect(await walletRequests(page)).toEqual(requestsBeforeRefresh);

  // The RPC can return the receipt from a fresher node than the one answering latest-state calls.
  let deploymentBlock: string | undefined;
  let vaultReadAtDeployment = false;
  let vaultAgentReadAtDeployment = false;
  const vaultOf = toFunctionSelector('vaultOf(address)');
  const vaultAgent = toFunctionSelector('agent()');
  await page.route(ANVIL_RPC_URL, async (route) => {
    const rpc = route.request().postDataJSON();
    if (rpc?.method === 'eth_getTransactionReceipt') {
      const response = await route.fetch();
      const { result } = await response.json();
      if (
        result?.status === '0x1' &&
        result.to?.toLowerCase() === VAULT_FACTORY_ADDRESS.toLowerCase()
      ) {
        deploymentBlock = result.blockNumber;
      }
      await route.fulfill({ response });
      return;
    }
    const call = rpc?.params?.[0];
    if (deploymentBlock && rpc?.method === 'eth_call') {
      const factoryRead =
        call?.to?.toLowerCase() === VAULT_FACTORY_ADDRESS.toLowerCase() &&
        call.data?.startsWith(vaultOf);
      const agentRead = call?.data === vaultAgent;
      if ((factoryRead || agentRead) && rpc.params[1] === 'latest') {
        await route.fulfill({
          headers: { 'access-control-allow-origin': '*' },
          json: { jsonrpc: '2.0', id: rpc.id, result: factoryRead ? zeroHash : '0x' },
        });
        return;
      }
      if (rpc.params[1] === deploymentBlock) {
        vaultReadAtDeployment ||= !!factoryRead;
        vaultAgentReadAtDeployment ||= agentRead;
      }
    }
    await route.continue();
  });
  const resumeLink = page.getByRole('button', { name: 'Continue account setup' });
  await resumeLink.click();
  await expect(
    page.getByText('Wallet request cancelled. Continue setup when you’re ready.'),
  ).toBeVisible();
  expect(deploymentBlock).toBeDefined();
  await expect(resumeLink).toBeEnabled();
  await expect(review.getByRole('listitem')).toHaveCount(1);
  await expect(review.getByRole('listitem')).toContainText(
    'Link your automation account and vault',
  );
  await resumeLink.click();
  await expect(page.getByRole('heading', { name: 'Fund your account' })).toBeFocused();
  expect(vaultReadAtDeployment).toBe(true);
  expect(vaultAgentReadAtDeployment).toBe(true);
  await page.unroute(ANVIL_RPC_URL);
  await expect(page.getByText('Step 5 of 5')).toBeVisible();

  const monitoring = page.getByRole('region', { name: 'Monitoring fees' });
  await expect(monitoring.getByLabel('Amount (REACT)')).toHaveValue('0.121');
  await expect(page.getByLabel('Amount (ETH)')).toHaveCount(0);
  await monitoring.getByRole('button', { name: 'Add REACT' }).click();
  await approveSignature(page, 'Reactive Lasna');

  const execution = page.getByRole('region', { name: 'Execution fees' });
  await expect(execution.getByRole('heading')).toBeFocused();
  await page.reload();
  await expect(page.getByText('0.121 REACT', { exact: true })).toBeVisible();
  await expect(execution.getByLabel('Amount (ETH)')).toHaveValue('0.0001');

  const depositTo = toFunctionSelector('depositTo(address)');
  const proxy = getChain(UNICHAIN_SEPOLIA_CHAIN_ID).callbackProxy.toLowerCase();
  const feeSelectors = ['reserves(address)', 'debt(address)'].map(toFunctionSelector);
  const preDepositHead = numberToHex(await chain.getBlockNumber({ cacheTime: 0 }));
  const reconciledAtReceipt = new Set<string>();
  let executionAttempts = 0;
  let executionHash: string | undefined;
  let executionBlockHash: string | undefined;
  let receiptStateAvailable = false;
  await page.route(ANVIL_RPC_URL, async (route) => {
    const rpc = route.request().postDataJSON();
    if (
      ['eth_sendTransaction', 'wallet_sendTransaction'].includes(rpc?.method) &&
      rpc.params[0]?.data?.startsWith(depositTo)
    ) {
      executionAttempts += 1;
      if (executionAttempts <= 2) {
        await route.fulfill({
          headers: { 'access-control-allow-origin': '*' },
          json: {
            jsonrpc: '2.0',
            id: rpc.id,
            error: {
              code: executionAttempts === 1 ? -32603 : -32000,
              message: 'RPC 0x515 Custom eth_sendRawTransaction: Request is being rate limited.',
            },
          },
        });
        return;
      }
      const response = await route.fetch();
      executionHash = (await response.json()).result;
      await route.fulfill({ response });
      return;
    }
    if (
      executionHash &&
      rpc?.method === 'eth_getTransactionReceipt' &&
      rpc.params[0] === executionHash
    ) {
      const response = await route.fetch();
      executionBlockHash = (await response.json()).result?.blockHash;
      await route.fulfill({ response });
      return;
    }
    const call = rpc?.params?.[0];
    const selector = call?.data?.slice(0, 10);
    if (
      executionBlockHash &&
      rpc?.method === 'eth_call' &&
      call?.to?.toLowerCase() === proxy &&
      feeSelectors.includes(selector)
    ) {
      if (rpc.params[1] === 'latest') {
        await route.fulfill({
          headers: { 'access-control-allow-origin': '*' },
          json: { jsonrpc: '2.0', id: rpc.id, result: zeroHash },
        });
        return;
      }
      if (rpc.params[1]?.blockHash === executionBlockHash && rpc.params[1].requireCanonical) {
        if (!receiptStateAvailable) {
          await route.fulfill({
            headers: { 'access-control-allow-origin': '*' },
            json: {
              jsonrpc: '2.0',
              id: rpc.id,
              error: { code: -32602, message: 'State at this block is temporarily unavailable' },
            },
          });
          return;
        }
        reconciledAtReceipt.add(selector);
      }
    }
    if (executionBlockHash && rpc?.method === 'eth_blockNumber') {
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: { jsonrpc: '2.0', id: rpc.id, result: preDepositHead },
      });
      return;
    }
    await route.continue();
  });
  await execution.getByRole('button', { name: 'Add ETH' }).click();
  await approveSignature(page, 'Unichain Sepolia');
  const throttled = execution.getByRole('alert');
  await expect(throttled).toContainText('Your wallet’s network provider is rate limiting');
  await expect(throttled).toContainText('Check your wallet activity');
  await expect(throttled.getByRole('link', { name: 'Change RPC in MetaMask' })).toBeVisible();
  await expect(execution.getByLabel('Amount (ETH)')).toHaveValue('0.0001');
  expect(executionAttempts).toBe(1);

  await execution.getByRole('button', { name: 'Add ETH' }).click();
  await approveSignature(page, 'Unichain Sepolia');
  await expect(throttled).toContainText('Your wallet’s network provider is rate limiting');
  expect(executionAttempts).toBe(2);

  await execution.getByRole('button', { name: 'Add ETH' }).click();
  await approveSignature(page, 'Unichain Sepolia');
  const executionRow = page.getByRole('listitem').filter({ hasText: 'Execution fees' });
  await expect(executionRow.getByText('Updating balance', { exact: true })).toBeVisible();
  await expect(executionRow.getByText('Top up needed')).toHaveCount(0);
  await expect(execution.getByText('Deposit confirmed. Updating your fee balance…')).toBeVisible();
  await expect(execution.getByLabel('Amount (ETH)')).toBeHidden();
  const checkFeeBalance = execution.getByRole('button', { name: 'Check fee balance' });
  await expect(checkFeeBalance).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(checkFeeBalance).toBeVisible();
  await expect(
    execution.getByText('Deposit confirmed. The fee balance is taking longer to update.'),
  ).toBeVisible();
  await expect(execution.getByRole('button', { name: 'Add ETH' })).toHaveCount(0);
  await expect(execution.getByRole('link', { name: 'View transaction' })).toHaveAttribute(
    'href',
    new RegExp(`${executionHash}$`),
  );

  const wideViewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 760 });
  await checkFeeBalance.scrollIntoViewIfNeeded();
  await expect(checkFeeBalance).toBeInViewport({ ratio: 1 });
  await expect(
    execution.getByText('Deposit confirmed. The fee balance is taking longer to update.'),
  ).toBeInViewport();

  receiptStateAvailable = true;
  await checkFeeBalance.click();
  await expect(page.getByRole('heading', { name: 'Your rule fees are funded' })).toBeVisible();
  await expect(executionRow.getByText('0.0001 ETH', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compose your first rule' })).toBeFocused();
  expect(reconciledAtReceipt).toEqual(new Set(feeSelectors));
  expect(executionAttempts).toBe(3);
  await page.unroute(ANVIL_RPC_URL);
  if (wideViewport) await page.setViewportSize(wideViewport);

  const compose = page.getByRole('button', { name: 'Compose your first rule' });
  await expect(compose).toBeEnabled();
  await expect(page.getByLabel('Amount (USDC)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add optional USDC' }).click();
  const usdc = page.getByRole('region', { name: 'Vault USDC' });
  await usdc.getByLabel('Amount (USDC)').fill('10');
  await usdc.getByRole('button', { name: 'Deposit USDC' }).click();
  await expect(compose).toBeDisabled();
  await approveSignature(page, 'Unichain Sepolia');
  await approveSignature(page, 'Unichain Sepolia');
  await expect(usdc.getByText('Deposit confirmed.')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 760 });
  await compose.click();
  const guide = page.getByRole('dialog', {
    name: /Choose a rule type|Set up your rule|Review and sign/,
  });
  await expect(guide).toHaveAccessibleName('Choose a rule type');
  await expect(guide).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  const replay = page.getByRole('button', { name: 'Rule composer guide' });
  await expect(replay).toBeFocused();
  await replay.click();
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(guide).toHaveAccessibleName('Set up your rule');
  await expect(guide).toBeInViewport({ ratio: 1 });
  await page.getByLabel('Pay with').selectOption({ label: 'USDC' });
  await page.getByLabel('Receive', { exact: true }).selectOption({ label: 'WETH' });
  await page.getByLabel('Amount to spend').fill('10');
  await page.getByLabel('Schedule').selectOption({ label: 'Every day' });
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(guide).toHaveAccessibleName('Review and sign');
  await page.getByRole('button', { name: 'Review and create rule' }).click();
  await expect(guide).toBeHidden();
  await approveSignature(page, 'Reactive Lasna', { switchNetwork: true });
  await expect(page.getByRole('heading', { name: /Rule created/ })).toBeVisible();

  await page.goto('/account');
  await expect(page.getByText('0.121 REACT', { exact: true })).toBeVisible();

  const agentOf = toFunctionSelector('agentOf(address)');
  const lookup = Promise.withResolvers<void>();
  await page.route(ANVIL_RPC_URL, async (route) => {
    const rpc = route.request().postDataJSON();
    if (rpc?.method === 'eth_call' && rpc.params[0]?.data?.startsWith(agentOf)) {
      await lookup.promise;
    }
    await route.fallback();
  });
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    await expect(page.getByText('Checking for an existing account…')).toBeVisible();
    await expect(page.getByText(/Step \d of 5/)).toHaveCount(0);
  } finally {
    lookup.resolve();
  }

  await expect(page.getByText('0.121 REACT', { exact: true })).toBeVisible();
  await expect(page.getByText('0.0001 ETH', { exact: true })).toBeVisible();
  await expect(page.getByText('10 USDC', { exact: true })).toBeVisible();

  await page.getByLabel('Withdrawal amount').fill('10');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await approveSignature(page, 'Unichain Sepolia');

  await expect(page.getByRole('heading', { name: /Withdrawn on Unichain Sepolia/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('0 USDC', { exact: true })).toBeVisible();
});
