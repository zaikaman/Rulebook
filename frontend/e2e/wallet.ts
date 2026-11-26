import { expect, type Page } from '@playwright/test';
import {
  BASE_SEPOLIA_CHAIN_ID,
  getChain,
  LASNA_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowVaultFactoryV2Abi,
  type FundsChainId,
} from '@rulebook/shared';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  numberToHex,
  parseAbi,
  zeroAddress,
  type Address,
} from 'viem';

import {
  ANVIL_BASE_RPC_URL,
  ANVIL_RPC_URL,
  USER_ADDRESS,
  WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS,
  WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
} from './fixtureConfig.js';

type WalletRequest = { readonly method: string; readonly chainId: number };
type WalletWindow = Window & { rulebookWalletRequests?: WalletRequest[] };

export function walletRequests(page: Page): Promise<WalletRequest[]> {
  return page.evaluate(() => {
    const requests = (window as WalletWindow).rulebookWalletRequests;
    if (!requests) throw new Error('The fixture wallet was not installed.');
    return requests;
  });
}

/**
 * Injects a minimal EIP-1193 provider backed by anvil's unlocked second account. No real
 * wallet, seed phrase, or public network is involved.
 */
export async function installWallet(
  page: Page,
  user: Address = USER_ADDRESS,
  initialChainId = UNICHAIN_SEPOLIA_CHAIN_ID,
  options: {
    blockFirstTypedSignature?: boolean;
    rejectFirstCall?: string;
    omitLasnaFromFirstGrant?: boolean;
    approvedTestnets?: readonly number[];
    installedTestnets?: readonly number[];
  } = {},
): Promise<void> {
  await page.addInitScript(
    ({
      user,
      rpc,
      baseRpc,
      initialChainId,
      lasnaId,
      unichainId,
      baseId,
      approvedTestnets,
      installedTestnets,
      options,
    }) => {
      let chainId = `0x${initialChainId.toString(16)}`;
      let accessBlocked = options.blockFirstTypedSignature;
      let typedSignatureDenied = false;
      const installedChains = new Set<string>(installedTestnets);
      const requestedChains = new Set<string>();
      let grantedChains: string[] = approvedTestnets;
      let omitLasna = options.omitLasnaFromFirstGrant;
      let callToReject = options.rejectFirstCall;
      const walletRequests: WalletRequest[] = [];
      (window as WalletWindow).rulebookWalletRequests = walletRequests;
      const listeners = new Map<string, Array<(value: unknown) => void>>();
      const emit = (event: string, value: unknown): void => {
        for (const listener of listeners.get(event) ?? []) listener(value);
      };
      const permissions = () => [
        {
          parentCapability: 'eth_accounts',
          caveats: [{ type: 'restrictReturnedAccounts', value: [user] }],
        },
        {
          parentCapability: 'endowment:permitted-chains',
          caveats: [{ type: 'restrictNetworkSwitching', value: grantedChains }],
        },
      ];

      const ethereum = {
        isMetaMask: true,
        selectedAddress: user,
        chainId,
        async request({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }): Promise<unknown> {
          if (
            [
              'wallet_switchEthereumChain',
              'eth_signTypedData_v4',
              'personal_sign',
              'eth_sendTransaction',
            ].includes(method)
          ) {
            walletRequests.push({ method, chainId: Number.parseInt(chainId, 16) });
          }
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [user];
          if (method === 'eth_chainId') return chainId;
          if (method === 'net_version') return String(Number.parseInt(chainId, 16));
          if (method === 'wallet_switchEthereumChain') {
            const target = (params?.[0] as { chainId?: string } | undefined)?.chainId;
            if (target) {
              if (!installedChains.has(target) && target !== chainId) {
                throw Object.assign(new Error('The network has not been added.'), { code: 4902 });
              }
              if (!grantedChains.includes(target)) requestedChains.add(target);
              chainId = target;
              emit('chainChanged', chainId);
            }
            return null;
          }
          if (method === 'wallet_addEthereumChain') {
            const target = (params?.[0] as { chainId: string }).chainId;
            walletRequests.push({ method, chainId: Number.parseInt(target, 16) });
            installedChains.add(target);
            requestedChains.add(target);
            chainId = target;
            emit('chainChanged', chainId);
            return null;
          }
          if (method === 'wallet_getPermissions') return permissions();
          if (method === 'wallet_requestPermissions' && requestedChains.size > 0) {
            walletRequests.push({ method, chainId: Number.parseInt(chainId, 16) });
            grantedChains = omitLasna
              ? [unichainId]
              : [unichainId, baseId, lasnaId].filter(
                  (id) => grantedChains.includes(id) || requestedChains.has(id),
                );
            omitLasna = false;
            return permissions();
          }
          if (method === 'wallet_requestPermissions' && typedSignatureDenied) {
            accessBlocked = false;
            return [{ parentCapability: 'eth_accounts' }];
          }
          if (
            method === 'eth_sendTransaction' &&
            requestedChains.has(chainId) &&
            !grantedChains.includes(chainId)
          ) {
            throw Object.assign(new Error('The requested account has not been authorized.'), {
              code: 4100,
            });
          }
          if (method === 'eth_signTypedData_v4' && accessBlocked) {
            typedSignatureDenied = true;
            throw Object.assign(new Error('The requested account has not been authorized.'), {
              code: 4100,
            });
          }

          const args = [...(params ?? [])];
          if (method === 'eth_sendTransaction' && args[0]) {
            const call = args[0] as { data?: string };
            if (callToReject && call.data?.startsWith(callToReject)) {
              callToReject = undefined;
              throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
            }
            args[0] = { ...(args[0] as Record<string, unknown>), from: user };
          }
          if (method === 'eth_signTypedData_v4' && typeof args[1] === 'string') {
            args[1] = JSON.parse(args[1]);
          }
          const endpoint = chainId === baseId ? baseRpc : rpc;
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: args }),
          });
          const body = (await response.json()) as {
            result?: unknown;
            error?: { code: number; message: string };
          };
          if (body.error) {
            const error = new Error(body.error.message) as Error & { code?: number };
            error.code = body.error.code;
            throw error;
          }
          return body.result;
        },
        on(event: string, listener: (value: unknown) => void): void {
          const existing = listeners.get(event) ?? [];
          existing.push(listener);
          listeners.set(event, existing);
        },
        removeListener(event: string, listener: (value: unknown) => void): void {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
          );
        },
      };

      Object.defineProperty(window, 'ethereum', { value: ethereum, configurable: true });
    },
    {
      user,
      rpc: ANVIL_RPC_URL,
      baseRpc: ANVIL_BASE_RPC_URL,
      initialChainId,
      lasnaId: numberToHex(LASNA_CHAIN_ID),
      unichainId: numberToHex(UNICHAIN_SEPOLIA_CHAIN_ID),
      baseId: numberToHex(BASE_SEPOLIA_CHAIN_ID),
      installedTestnets: (
        options.installedTestnets ??
        options.approvedTestnets ??
        SUPPORTED_CHAIN_IDS
      ).map((id) => numberToHex(id)),
      approvedTestnets: (options.approvedTestnets ?? SUPPORTED_CHAIN_IDS).map((id) =>
        numberToHex(id),
      ),
      options,
    },
  );
}

export async function approveSignature(
  page: Page,
  network: string,
  { switchNetwork = false } = {},
) {
  if (switchNetwork) {
    const switching = page.getByRole('dialog', { name: `Switch to ${network}` });
    await expect(switching.locator('[data-chain-id]')).toBeVisible({ timeout: 60_000 });
    await expect(switching.locator('[data-chain-id]')).toHaveText(network);
    await switching.getByRole('button', { name: `Switch to ${network}` }).click();
  }
  const review = page.getByRole('dialog', { name: `Review signature on ${network}` });
  await expect(review.locator('[data-chain-id]')).toBeVisible({ timeout: 60_000 });
  await expect(review.locator('[data-chain-id]')).toHaveText(network);
  const prompt = await review.elementHandle();
  await review.getByRole('button', { name: 'Continue to wallet' }).click();
  await prompt.waitForElementState('hidden', { timeout: 60_000 });
}

export async function skipRuleFunding(page: Page) {
  await page.getByRole('button', { name: 'Compose and fund later' }).click();
  await page.getByRole('button', { name: 'Skip guide' }).click();
}

/** Funds the V2 workflow vault that account setup creates for this owner. */
export async function fundFixtureWorkflowVault(
  owner: Address,
  amount: bigint,
  chain: FundsChainId = UNICHAIN_SEPOLIA_CHAIN_ID,
) {
  const rpcUrl = chain === BASE_SEPOLIA_CHAIN_ID ? ANVIL_BASE_RPC_URL : ANVIL_RPC_URL;
  const factoryAddress =
    chain === BASE_SEPOLIA_CHAIN_ID
      ? WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS
      : WORKFLOW_V2_VAULT_FACTORY_ADDRESS;
  const transport = http(rpcUrl);
  const client = createPublicClient({ transport });
  const wallet = createWalletClient({ transport });
  const token = getChain(chain).usdc;
  const vault = await client.readContract({
    address: factoryAddress,
    abi: workflowVaultFactoryV2Abi,
    functionName: 'vaultOf',
    args: [owner],
  });
  if (vault === zeroAddress) throw new Error('Fixture workflow vault has not been deployed.');

  const mint = await wallet.writeContract({
    address: token,
    abi: parseAbi(['function mint(address to, uint256 amount)']),
    functionName: 'mint',
    args: [owner, amount],
    account: owner,
    chain: null,
  });
  const mintReceipt = await client.waitForTransactionReceipt({ hash: mint });
  if (mintReceipt.status !== 'success') throw new Error('Fixture workflow vault mint reverted.');
  // The V2 Vault holds its principal directly, so funding is a plain token transfer.
  const transfer = await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [vault, amount],
    account: owner,
    chain: null,
  });
  const transferReceipt = await client.waitForTransactionReceipt({ hash: transfer });
  if (transferReceipt.status !== 'success') {
    throw new Error('Fixture workflow vault funding reverted.');
  }
}
