import {
  executionCreditAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentAbi,
  workflowDirectoryAbi,
  workflowVaultAbi,
  workflowVaultFactoryAbi,
  type WorkflowDraft,
  encodeWorkflow,
} from '@rulebook/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddress,
  keccak256,
  maxUint256,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { useAccount, useSendTransaction } from 'wagmi';

import { useChainGuard } from '@/hooks/useChainGuard';
import { LASNA_CONFIG, UNICHAIN_CONFIG } from '@/lib/contracts';
import { lasnaPublicClient as lasna, unichainPublicClient as unichain } from '@/lib/wagmi';

function configured(value: unknown): Address | undefined {
  return typeof value === 'string' && isAddress(value) && value !== zeroAddress ? value : undefined;
}

export const workflowDirectory = configured(import.meta.env.VITE_WORKFLOW_DIRECTORY_ADDRESS);
const vaultFactory = configured(import.meta.env.VITE_WORKFLOW_VAULT_FACTORY_ADDRESS);
export const workflowDeploymentReady = Boolean(workflowDirectory && vaultFactory);

export async function readWorkflowAccount(owner: Address) {
  if (!workflowDirectory || !vaultFactory)
    throw new Error('Workflow contracts have not been configured.');
  const [agent, vault] = await Promise.all([
    lasna.readContract({
      address: workflowDirectory,
      abi: workflowDirectoryAbi,
      functionName: 'agentOf',
      args: [owner],
    }),
    unichain.readContract({
      address: vaultFactory,
      abi: workflowVaultFactoryAbi,
      functionName: 'vaultOf',
      args: [owner],
    }),
  ]);
  const linked =
    agent !== zeroAddress &&
    vault !== zeroAddress &&
    (
      await lasna.readContract({ address: agent, abi: workflowAgentAbi, functionName: 'vault' })
    ).toLowerCase() === vault.toLowerCase();
  return { agent, vault, linked };
}

export async function readWorkflowState(agent: Address, vault: Address, id: Hex) {
  const [entry, auth] = await Promise.all([
    lasna.readContract({
      address: agent,
      abi: workflowAgentAbi,
      functionName: 'workflows',
      args: [id],
    }),
    unichain.readContract({
      address: vault,
      abi: workflowVaultAbi,
      functionName: 'authorizations',
      args: [id],
    }),
  ]);
  return { entry, auth };
}

export async function listWorkflows(agent: Address) {
  const ids = await lasna.readContract({
    address: agent,
    abi: workflowAgentAbi,
    functionName: 'workflowIds',
  });
  return Promise.all(
    [...ids].reverse().map(async (id) => {
      const [title, entry] = await Promise.all([
        lasna.readContract({
          address: agent,
          abi: workflowAgentAbi,
          functionName: 'titles',
          args: [id],
        }),
        lasna.readContract({
          address: agent,
          abi: workflowAgentAbi,
          functionName: 'workflows',
          args: [id],
        }),
      ]);
      return { id, title, entry };
    }),
  );
}

export function readWorkflowProgram(agent: Address, hash: Hex) {
  return lasna.readContract({
    address: agent,
    abi: workflowAgentAbi,
    functionName: 'programByHash',
    args: [hash],
  });
}

export function readWorkflowTitle(agent: Address, id: Hex) {
  return lasna.readContract({
    address: agent,
    abi: workflowAgentAbi,
    functionName: 'titles',
    args: [id],
  });
}

export async function getPublishedVersions(agent: Address, id: Hex) {
  const directory = workflowDirectory;
  if (!directory) return [];
  const versions = await lasna.readContract({
    address: directory,
    abi: workflowDirectoryAbi,
    functionName: 'publishedVersions',
    args: [agent, id],
  });
  const rows = await Promise.all(
    versions.map(async (listingId) => {
      const listing = await lasna.readContract({
        address: directory,
        abi: workflowDirectoryAbi,
        functionName: 'listings',
        args: [listingId],
      });
      return { listingId, programHash: listing[3], visible: listing[5] };
    }),
  );
  return rows.filter((row) => row.visible).reverse();
}

export async function getVaultProgram(vault: Address, hash: Hex) {
  return unichain.readContract({
    address: vault,
    abi: workflowVaultAbi,
    functionName: 'programByHash',
    args: [hash],
  });
}

export async function getWorkflowBalances(owner: Address, agent: Address, vault: Address) {
  function credit(
    chainId: typeof LASNA_CHAIN_ID | typeof UNICHAIN_SEPOLIA_CHAIN_ID,
    account: Address,
  ) {
    const isLasna = chainId === LASNA_CHAIN_ID;
    return (isLasna ? lasna : unichain).readContract({
      address: isLasna ? LASNA_CONFIG.systemContract : UNICHAIN_CONFIG.callbackProxy,
      abi: executionCreditAbi,
      functionName: 'reserves',
      args: [account],
    });
  }
  const [watch, execution, usdc, weth, walletUsdc] = await Promise.all([
    credit(LASNA_CHAIN_ID, agent),
    credit(UNICHAIN_SEPOLIA_CHAIN_ID, vault),
    unichain.readContract({
      address: UNICHAIN_CONFIG.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [vault],
    }),
    unichain.readContract({
      address: UNICHAIN_CONFIG.weth,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [vault],
    }),
    unichain.readContract({
      address: UNICHAIN_CONFIG.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    }),
  ]);
  return { watch, execution, usdc, weth, walletUsdc };
}

export function useWorkflowAccountQuery() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ['workflow-account', address],
    enabled: Boolean(address && workflowDeploymentReady),
    queryFn: () => (address ? readWorkflowAccount(address) : null),
    refetchInterval: 15_000,
  });
}

type WorkflowChain = typeof LASNA_CHAIN_ID | typeof UNICHAIN_SEPOLIA_CHAIN_ID;

export function useWorkflowWallet() {
  const { address: owner } = useAccount();
  const review = useChainGuard();
  const { sendTransactionAsync } = useSendTransaction();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [transaction, setTransaction] = useState<{ hash: Hex; chainId: WorkflowChain }>();

  async function send(
    chainId: WorkflowChain,
    target: Address,
    data: Hex,
    effect: string,
    amount: string,
    value = 0n,
  ) {
    if (!owner) throw new Error('Connect your wallet first.');
    const targetLabel =
      chainId === LASNA_CHAIN_ID ? 'Reactive Lasna contract' : 'Unichain Sepolia contract';
    const reader = chainId === LASNA_CHAIN_ID ? lasna : unichain;
    setStatus(effect);
    const hash = await review(
      { chainId, target, targetLabel, effect, amount },
      owner,
      async (connector) => {
        const fees =
          chainId === LASNA_CHAIN_ID
            ? {
                maxPriorityFeePerGas: 1n,
                maxFeePerGas: (await reader.getGasPrice()) * 2n + 1n,
              }
            : {};
        return sendTransactionAsync({
          connector,
          chainId,
          account: owner,
          to: target,
          data,
          value,
          ...fees,
        });
      },
      undefined,
      async () => {
        await reader.estimateGas({ account: owner, to: target, data, value });
      },
    );
    setTransaction({ hash, chainId });
    const receipt = await reader.waitForTransactionReceipt({
      hash,
      confirmations: 2,
      timeout: 120_000,
    });
    if (receipt.status !== 'success')
      throw new Error('The signed transaction reverted. Review the settings and try again.');
  }

  async function perform<T>(task: (signer: Address) => Promise<T>) {
    if (busy) return undefined;
    if (!owner) {
      setError('Connect your wallet first.');
      return undefined;
    }
    setBusy(true);
    setError(undefined);
    try {
      return await task(owner);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.split('\n')[0] : 'The request failed.');
      return undefined;
    } finally {
      setBusy(false);
      setStatus(undefined);
      await query.invalidateQueries({
        predicate: (entry) => String(entry.queryKey[0]).startsWith('workflow-'),
      });
    }
  }

  async function ensureAccount(signer: Address) {
    if (!workflowDirectory || !vaultFactory)
      throw new Error('Workflow contracts have not been configured.');
    let account = await readWorkflowAccount(signer);
    if (account.agent === zeroAddress) {
      await send(
        LASNA_CHAIN_ID,
        workflowDirectory,
        encodeFunctionData({ abi: workflowDirectoryAbi, functionName: 'create' }),
        'Create your workflow Agent on Reactive Lasna.',
        'Network fees only',
      );
      account = await readWorkflowAccount(signer);
    }
    if (account.vault === zeroAddress) {
      await send(
        UNICHAIN_SEPOLIA_CHAIN_ID,
        vaultFactory,
        encodeFunctionData({
          abi: workflowVaultFactoryAbi,
          functionName: 'create',
          args: [account.agent],
        }),
        'Create your Vault on Unichain Sepolia.',
        'Network fees only',
      );
      account = await readWorkflowAccount(signer);
    }
    if (!account.linked) {
      const bound = await unichain.readContract({
        address: account.vault,
        abi: workflowVaultAbi,
        functionName: 'agent',
      });
      if (bound.toLowerCase() !== account.agent.toLowerCase())
        throw new Error('Your Vault belongs to a different workflow Agent.');
      await send(
        LASNA_CHAIN_ID,
        account.agent,
        encodeFunctionData({
          abi: workflowAgentAbi,
          functionName: 'linkVault',
          args: [account.vault],
        }),
        'Link your own Vault to your workflow Agent.',
        'Network fees only',
      );
    }
    return account;
  }

  function activate(id: Hex, draft: WorkflowDraft, source: bigint) {
    return perform(async (signer) => {
      encodeWorkflow(draft);
      const account = await ensureAccount(signer);
      const program = encodeWorkflow(draft, account.vault);
      const hash = keccak256(program);
      const state = await readWorkflowState(account.agent, account.vault, id);
      if (state.entry[6] || state.auth[4]) throw new Error('This workflow has been cancelled.');
      if (
        state.entry[5] &&
        state.auth[3] &&
        state.entry[1] === state.auth[1] &&
        state.auth[0] === hash &&
        state.entry[0] === hash
      ) {
        const title = await lasna.readContract({
          address: account.agent,
          abi: workflowAgentAbi,
          functionName: 'titles',
          args: [id],
        });
        if (title === draft.title.trim()) return true;
      }
      const limit = 'Up to ' + (draft.spendLimit || '0') + ' USDC per run';
      if (state.entry[1] === 0n && source !== 0n && workflowDirectory) {
        const listing = await lasna.readContract({
          address: workflowDirectory,
          abi: workflowDirectoryAbi,
          functionName: 'listings',
          args: [source],
        });
        if (!listing[5])
          throw new Error(
            'The source has been unpublished. Remove the Marketplace link to activate your draft.',
          );
      }
      const staged = state.auth[3] && state.auth[0] === hash && state.auth[1] > state.entry[1];
      const epoch = staged
        ? state.auth[1]
        : (state.entry[1] > state.auth[1] ? state.entry[1] : state.auth[1]) + 1n;
      if (!staged) {
        await send(
          UNICHAIN_SEPOLIA_CHAIN_ID,
          account.vault,
          encodeFunctionData({
            abi: workflowVaultAbi,
            functionName: 'authorize',
            args: [id, epoch, program],
          }),
          'Authorize the reviewed steps and spending limit on your Vault.',
          limit,
        );
      }
      const auth = await unichain.readContract({
        address: account.vault,
        abi: workflowVaultAbi,
        functionName: 'authorizations',
        args: [id],
      });
      if (auth[1] !== epoch || auth[0] !== hash || !auth[3])
        throw new Error('The Vault authorization changed. Review your changes and try again.');
      await send(
        LASNA_CHAIN_ID,
        account.agent,
        encodeFunctionData({
          abi: workflowAgentAbi,
          functionName: 'enable',
          args: [
            id,
            epoch,
            auth[2],
            program,
            state.entry[1] === 0n ? source : 0n,
            draft.title.trim(),
          ],
        }),
        'Enable the reviewed workflow on Reactive Lasna.',
        limit,
      );
      return true;
    });
  }

  function disable(id: Hex, cancel: boolean) {
    return perform(async (signer) => {
      const { agent, vault } = await readWorkflowAccount(signer);
      const { entry, auth } = await readWorkflowState(agent, vault, id);
      if (auth[1] > 0n && !auth[4] && (auth[3] || cancel)) {
        await send(
          UNICHAIN_SEPOLIA_CHAIN_ID,
          vault,
          encodeFunctionData({
            abi: workflowVaultAbi,
            functionName: 'revoke',
            args: [id, auth[1], cancel],
          }),
          'Block this workflow from moving funds on Unichain Sepolia.',
          'Network fees only',
        );
      }
      if (entry[1] > 0n && !entry[6] && (entry[5] || cancel)) {
        await send(
          LASNA_CHAIN_ID,
          agent,
          encodeFunctionData({
            abi: workflowAgentAbi,
            functionName: 'disable',
            args: [id, entry[1], cancel],
          }),
          cancel ? 'Cancel this workflow on Reactive Lasna.' : 'Pause new runs on Reactive Lasna.',
          'Network fees only',
        );
      }
      return true;
    });
  }

  function publish(id: Hex, title: string, description: string) {
    return perform(async () => {
      if (!workflowDirectory) throw new Error('The Marketplace registry is not configured.');
      const encoder = new TextEncoder();
      if (
        encoder.encode(title.trim()).length > 80 ||
        encoder.encode(description.trim()).length > 280 ||
        !description.trim()
      ) {
        throw new Error('Enter a description between 1 and 280 bytes.');
      }
      await send(
        LASNA_CHAIN_ID,
        workflowDirectory,
        encodeFunctionData({
          abi: workflowDirectoryAbi,
          functionName: 'publish',
          args: [id, title.trim(), description.trim()],
        }),
        'Publish this workflow version on the Marketplace.',
        'Network fees only',
      );
      return true;
    });
  }

  function unpublish(id: bigint) {
    return perform(async () => {
      if (!workflowDirectory) throw new Error('The Marketplace registry is not configured.');
      await send(
        LASNA_CHAIN_ID,
        workflowDirectory,
        encodeFunctionData({ abi: workflowDirectoryAbi, functionName: 'unpublish', args: [id] }),
        'Remove this workflow version from the Marketplace.',
        'Network fees only',
      );
      return true;
    });
  }

  function fund(
    kind: 'watch' | 'execution' | 'usdc' | 'withdraw-usdc' | 'withdraw-weth',
    amount: bigint,
  ) {
    return perform(async (signer) => {
      if (amount <= 0n || amount > maxUint256) throw new Error('Enter a valid amount.');
      const { agent, vault, linked } = await readWorkflowAccount(signer);
      if (!linked) throw new Error('Finish setting up your workflow account first.');
      if (kind === 'watch' || kind === 'execution') {
        const watching = kind === 'watch';
        await send(
          watching ? LASNA_CHAIN_ID : UNICHAIN_SEPOLIA_CHAIN_ID,
          watching ? LASNA_CONFIG.systemContract : UNICHAIN_CONFIG.callbackProxy,
          encodeFunctionData({
            abi: executionCreditAbi,
            functionName: 'depositTo',
            args: [watching ? agent : vault],
          }),
          watching ? 'Add watching credit for your Agent.' : 'Add execution credit for your Vault.',
          formatUnits(amount, 18) + (watching ? ' lREACT' : ' ETH'),
          amount,
        );
      } else if (kind === 'usdc') {
        await send(
          UNICHAIN_SEPOLIA_CHAIN_ID,
          UNICHAIN_CONFIG.usdc,
          encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [vault, amount] }),
          'Send test USDC to your Vault. An active payment workflow can run on this deposit.',
          formatUnits(amount, 6) + ' USDC',
        );
      } else {
        const weth = kind === 'withdraw-weth';
        await send(
          UNICHAIN_SEPOLIA_CHAIN_ID,
          vault,
          encodeFunctionData({
            abi: workflowVaultAbi,
            functionName: 'withdraw',
            args: [weth ? UNICHAIN_CONFIG.weth : UNICHAIN_CONFIG.usdc, amount],
          }),
          'Withdraw from your Vault to your wallet.',
          formatUnits(amount, weth ? 18 : 6) + (weth ? ' WETH' : ' USDC'),
        );
      }
      return true;
    });
  }

  return {
    owner,
    busy,
    error,
    status,
    transaction,
    setup: () => perform(ensureAccount),
    activate,
    disable,
    publish,
    unpublish,
    fund,
  };
}
