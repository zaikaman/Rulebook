import { expect, test } from '@playwright/test';
import { createTestClient, http, publicActions, toFunctionSelector, zeroHash } from 'viem';

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
  await expect(page.getByText('Step 1 of 4')).toBeVisible();
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
    await expect(page.getByText('Step 3 of 4')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Compose a rule' })).toBeFocused();
  expect(vaultReadAtDeployment).toBe(true);
  expect(vaultAgentReadAtDeployment).toBe(true);
  await page.unroute(ANVIL_RPC_URL);
  await expect(page.getByRole('heading', { name: 'Before your first rule runs' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Add funds', exact: true }).click();
  const funding = page.getByRole('region', { name: 'Fund your account' });
  await expect(funding.getByLabel('Fund with')).toHaveValue('watching');
  await funding.getByLabel('Amount (REACT)').fill('0.1');
  await expect(funding.getByText(/Less than one day of monitoring/)).toBeVisible();
  await funding.getByRole('button', { name: 'Add network fees' }).click();
  await approveSignature(page, 'Reactive Lasna');
  await expect(funding.getByText('Deposit confirmed.')).toBeVisible();

  await expect(funding.getByLabel('Fund with')).toHaveValue('execution');
  await funding.getByLabel('Amount (ETH)').fill('0.01');
  await funding.getByRole('button', { name: 'Add network fees' }).click();
  await approveSignature(page, 'Unichain Sepolia', { switchNetwork: true });
  await expect(funding.getByText('Deposit confirmed.')).toBeVisible();

  await expect(funding.getByLabel('Fund with')).toHaveValue('vault');
  await funding.getByLabel('Amount (USDC)').fill('10');
  await funding.getByRole('button', { name: 'Deposit USDC' }).click();
  await approveSignature(page, 'Unichain Sepolia');
  await approveSignature(page, 'Unichain Sepolia');
  await expect(funding.getByText('Deposit confirmed.')).toBeVisible();

  await page.getByRole('link', { name: 'Account & Vault' }).click();
  await expect(page.getByText('0.1 REACT', { exact: true })).toBeVisible();
  await expect(page.getByText('0.01 ETH', { exact: true })).toBeVisible();
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
