import {
  addressSchema,
  encodeWorkflowV2,
  executionCreditAbi,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowProgramValidatorV2Abi,
  workflowV2Action,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  type WeeklyBudgetAmounts,
  type WorkflowV2Program,
} from '@rulebook/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddressEqual,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { useAccount, useSendTransaction } from 'wagmi';
import { z } from 'zod';

import type { SetupWallet } from '@/hooks/useAccountSetup';
import { useChainGuard } from '@/hooks/useChainGuard';
import { SetupTransactionError } from '@/lib/errors';
import { type SignatureDetails } from '@/lib/signatures';
import { lasnaPublicClient as lasna, unichainPublicClient } from '@/lib/wagmi';
import { workflowFundingIssues } from './fundingV2';

export type SettlementChain = typeof UNICHAIN_SEPOLIA_CHAIN_ID;
type WalletChain = SignatureDetails['chainId'];

const target = z.object({ factory: addressSchema, startBlock: z.number().int().positive() });
const deploymentSchema = z.object({ lasna: target, unichain: target });

function deployment() {
  try {
    return deploymentSchema.parse(
      JSON.parse(import.meta.env.VITE_WORKFLOW_V2_DEPLOYMENT ?? 'null'),
    );
  } catch {
    return undefined;
  }
}

export const workflowV2Deployment = deployment();
export const workflowActivationEnabled = import.meta.env.VITE_WORKFLOW_V2_ACTIVATION === 'true';

export function settlementFactory() {
  return workflowV2Deployment?.unichain.factory;
}

export function workflowClient(chain: WalletChain) {
  if (chain === LASNA_CHAIN_ID) return lasna;
  return unichainPublicClient;
}

export function v2Network(chain: WalletChain) {
  return getChain(chain);
}

export function v2Explorer(chain: number, hash: Hex) {
  if (chain !== LASNA_CHAIN_ID && chain !== UNICHAIN_SEPOLIA_CHAIN_ID) return undefined;
  return `${v2Network(chain).explorerUrl}/tx/${hash}`;
}

export function weeklyLimitLabel(amount: bigint, decimals: number, asset: string) {
  return amount === 0n ? `${asset} unlimited` : `${formatUnits(amount, decimals)} ${asset}`;
}

export function formatWorkflowCaps(program: WorkflowV2Program, budget?: WeeklyBudgetAmounts) {
  const caps = [
    `${formatUnits(program.usdcCap, 6)} USDC per run`,
    `${formatUnits(program.wethCap, 18)} WETH per run`,
  ];
  if (budget) {
    caps.push(`${weeklyLimitLabel(budget.usdc, 6, 'USDC')} weekly`);
    caps.push(`${weeklyLimitLabel(budget.weth, 18, 'WETH')} weekly`);
  }
  return caps.join(', ');
}

export async function validateV2Program(encoded: Hex) {
  const factory = settlementFactory();
  if (!factory) return;
  const validator = await unichainPublicClient.readContract({
    address: factory,
    abi: workflowVaultFactoryV2Abi,
    functionName: 'validator',
  });
  await unichainPublicClient.readContract({
    address: validator,
    abi: workflowProgramValidatorV2Abi,
    functionName: 'validateProgram',
    args: [encoded],
  });
}

export async function readAgent(owner: Address, blockNumber?: bigint) {
  const factory = workflowV2Deployment?.lasna.factory;
  return factory
    ? lasna.readContract({
        address: factory,
        abi: workflowAgentFactoryV2Abi,
        functionName: 'agentOf',
        args: [owner],
        blockNumber,
      })
    : zeroAddress;
}

export async function readVault(owner: Address, chain: SettlementChain, blockNumber?: bigint) {
  const factory = settlementFactory();
  return factory
    ? workflowClient(chain).readContract({
        address: factory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'vaultOf',
        args: [owner],
        blockNumber,
      })
    : zeroAddress;
}

export function v2Entry(agent: Address, id: Hex) {
  return lasna.readContract({
    address: agent,
    abi: workflowAgentV2Abi,
    functionName: 'entries',
    args: [id],
  });
}

export function v2Authorization(chain: SettlementChain, vault: Address, id: Hex) {
  return workflowClient(chain).readContract({
    address: vault,
    abi: workflowVaultV2Abi,
    functionName: 'authorizations',
    args: [id],
  });
}

export interface WorkflowWeeklyBudget {
  readonly usdcLimit: bigint;
  readonly wethLimit: bigint;
  readonly usdcSpent: bigint;
  readonly wethSpent: bigint;
  readonly usdcRemaining: bigint;
  readonly wethRemaining: bigint;
  readonly resetsAt: bigint;
  readonly revision: number;
}

/** The Vault view is the source of truth for weekly limits, usage, and the reset time. */
export async function readWorkflowWeeklyBudget(
  chain: SettlementChain,
  vault: Address,
  id: Hex,
): Promise<WorkflowWeeklyBudget> {
  const result = await workflowClient(chain).readContract({
    address: vault,
    abi: workflowVaultV2Abi,
    functionName: 'weeklyBudget',
    args: [id],
  });
  return {
    usdcLimit: result[0],
    wethLimit: result[1],
    usdcSpent: result[2],
    wethSpent: result[3],
    usdcRemaining: result[4],
    wethRemaining: result[5],
    resetsAt: result[6],
    revision: result[7],
  };
}

async function workflowVersion(agent: Address, vault: Address, id: Hex) {
  const chain = UNICHAIN_SEPOLIA_CHAIN_ID;
  const [entry, auth] = await Promise.all([v2Entry(agent, id), v2Authorization(chain, vault, id)]);
  if (entry[1] === 0n && auth[1] === 0n)
    throw new Error('This workflow was not found for the connected wallet.');
  const staged = auth[1] > entry[1] && (auth[3] || entry[1] === 0n);
  const title = staged
    ? await unichainPublicClient.readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'titles',
        args: [id],
      })
    : await lasna.readContract({
        address: agent,
        abi: workflowAgentV2Abi,
        functionName: 'titles',
        args: [id],
      });
  const active = entry[4] !== 0 && auth[3] && entry[1] === auth[1] && entry[0] === auth[0];
  return { agent, vault, id, chain, entry, auth, title, active, staged } as const;
}

async function readWorkflowVersionDetails(item: Awaited<ReturnType<typeof workflowVersion>>) {
  const [program, memory, budget] = await Promise.all([
    item.staged
      ? unichainPublicClient.readContract({
          address: item.vault,
          abi: workflowVaultV2Abi,
          functionName: 'programs',
          args: [item.auth[0]],
        })
      : lasna.readContract({
          address: item.agent,
          abi: workflowAgentV2Abi,
          functionName: 'programs',
          args: [item.entry[0]],
        }),
    unichainPublicClient.readContract({
      address: item.vault,
      abi: workflowVaultV2Abi,
      functionName: 'workflowMemory',
      args: [item.id],
    }),
    readWorkflowWeeklyBudget(item.chain, item.vault, item.id),
  ]);
  return { ...item, program, budget, closed: memory[7] };
}

export async function readWorkflowsV2(owner: Address) {
  const [agent, vault] = await Promise.all([
    readAgent(owner),
    readVault(owner, UNICHAIN_SEPOLIA_CHAIN_ID),
  ]);
  if (agent === zeroAddress || vault === zeroAddress) return [];
  const ids = await unichainPublicClient.readContract({
    address: vault,
    abi: workflowVaultV2Abi,
    functionName: 'workflowIds',
  });
  return Promise.all(
    ids
      .slice()
      .reverse()
      .map(async (id) => readWorkflowVersionDetails(await workflowVersion(agent, vault, id))),
  );
}

export async function readWorkflowV2(owner: Address, id: Hex) {
  const [agent, vault] = await Promise.all([
    readAgent(owner),
    readVault(owner, UNICHAIN_SEPOLIA_CHAIN_ID),
  ]);
  if (agent === zeroAddress || vault === zeroAddress)
    throw new Error('This wallet has no workflow account.');
  return readWorkflowVersionDetails(await workflowVersion(agent, vault, id));
}

export async function readFundsV2(owner: Address, chain: SettlementChain) {
  const [agent, vault] = await Promise.all([readAgent(owner), readVault(owner, chain)]);
  const client = workflowClient(chain);
  const lasnaSystem = getChain(LASNA_CHAIN_ID).systemContract;
  const factory = settlementFactory();
  const proxy = factory
    ? await client.readContract({
        address: factory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'callbackProxy',
      })
    : undefined;
  const [usdc, weth, watch, execution, native, walletNative, walletWatch] = await Promise.all([
    vault === zeroAddress
      ? zeroAddress
      : client.readContract({ address: vault, abi: workflowVaultV2Abi, functionName: 'usdc' }),
    vault === zeroAddress
      ? zeroAddress
      : client.readContract({ address: vault, abi: workflowVaultV2Abi, functionName: 'weth' }),
    agent === zeroAddress
      ? 0n
      : lasna.readContract({
          address: lasnaSystem,
          abi: executionCreditAbi,
          functionName: 'reserves',
          args: [agent],
        }),
    vault === zeroAddress || !proxy
      ? 0n
      : client.readContract({
          address: proxy,
          abi: executionCreditAbi,
          functionName: 'reserves',
          args: [vault],
        }),
    vault === zeroAddress ? 0n : client.getBalance({ address: vault }),
    client.getBalance({ address: owner }),
    lasna.getBalance({ address: owner }),
  ]);
  const tokenBalance = (token: Address, account: Address) =>
    token === zeroAddress
      ? 0n
      : client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        });
  const [stable, wrapped, refillAllowance, walletStable, walletWrapped] = await Promise.all([
    tokenBalance(usdc, vault),
    tokenBalance(weth, vault),
    usdc === zeroAddress
      ? 0n
      : client.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [owner, vault],
        }),
    tokenBalance(usdc, owner),
    tokenBalance(weth, owner),
  ]);
  return {
    agent,
    vault,
    proxy,
    lasnaSystem,
    usdc,
    weth,
    watch,
    execution,
    native,
    stable,
    wrapped,
    refillAllowance,
    walletStable,
    walletWrapped,
    walletNative,
    walletWatch,
  };
}

export function useWorkflowV2Wallet() {
  const { address: owner } = useAccount();
  const guard = useChainGuard();
  const { sendTransactionAsync } = useSendTransaction();
  const queries = useQueryClient();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [transaction, setTransaction] = useState<{ chain: WalletChain; hash: Hex }>();

  async function waitForState<T>(
    read: () => Promise<T>,
    ready: (state: T) => boolean,
    confirmedSetup?: { chain: WalletChain; hash: Hex },
  ) {
    setStatus('Waiting for the confirmed change to appear on the testnet.');
    let lastError: unknown;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const state = await read();
        if (ready(state)) return state;
      } catch (error) {
        // A load-balanced RPC can temporarily lack state at the transaction's receipt block.
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (confirmedSetup) {
      throw new SetupTransactionError(
        confirmedSetup.chain,
        confirmedSetup.hash,
        'The transaction confirmed. Check the receipt and continue setup once the network has synced.',
        lastError,
      );
    }
    throw new Error(
      'The transaction confirmed. The network is still syncing its state. Reopen the draft to continue.',
    );
  }

  async function send(
    chain: WalletChain,
    target: Address,
    data: Hex,
    effect: string,
    amount = 'Network fees only',
    value = 0n,
    reviewedConnector?: string,
  ) {
    if (!owner) throw new Error('Connect your wallet first.');
    const client = workflowClient(chain);
    setStatus(effect);
    const hash = await guard(
      { chainId: chain, target, targetLabel: 'Contract address', effect, amount },
      owner,
      async (connector) =>
        sendTransactionAsync({
          connector,
          chainId: chain,
          account: owner,
          to: target,
          data,
          value,
          ...(chain === LASNA_CHAIN_ID
            ? { maxPriorityFeePerGas: 1n, maxFeePerGas: (await client.getGasPrice()) * 2n + 1n }
            : {}),
        }),
      reviewedConnector,
      async () => {
        await client.estimateGas({ account: owner, to: target, data, value });
      },
    );
    setTransaction({ chain, hash });
    const receipt = await client
      .waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 })
      .catch((cause: unknown) => {
        throw new SetupTransactionError(
          chain,
          hash,
          'Confirmation is unavailable. Check the transaction before retrying.',
          cause,
        );
      });
    if (receipt.status !== 'success') {
      throw new SetupTransactionError(chain, hash, 'The signed transaction reverted.');
    }
    return receipt;
  }

  async function perform(task: (signer: Address) => Promise<void>) {
    if (!owner || locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await task(owner);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message.split('\n')[0] : 'The wallet request failed.',
      );
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
      setStatus(undefined);
      void queries.invalidateQueries({ queryKey: ['workflow-v2'] });
    }
  }

  async function createAgent(signer: Address, reviewedConnector?: string) {
    const agentFactory = workflowV2Deployment?.lasna.factory;
    if (!agentFactory) throw new Error('This testnet deployment is unavailable.');
    const receipt = await send(
      LASNA_CHAIN_ID,
      agentFactory,
      encodeFunctionData({ abi: workflowAgentFactoryV2Abi, functionName: 'create' }),
      'Create your workflow Agent on Reactive Lasna.',
      undefined,
      undefined,
      reviewedConnector,
    );
    return waitForState(
      () => readAgent(signer, receipt.blockNumber),
      (address) => address !== zeroAddress,
      { chain: LASNA_CHAIN_ID, hash: receipt.transactionHash },
    );
  }

  async function createVault(signer: Address, agent: Address, reviewedConnector?: string) {
    const chain = UNICHAIN_SEPOLIA_CHAIN_ID;
    const vaultFactory = settlementFactory();
    if (!vaultFactory) throw new Error('This testnet deployment is unavailable.');
    const receipt = await send(
      chain,
      vaultFactory,
      encodeFunctionData({ abi: workflowVaultFactoryV2Abi, functionName: 'create', args: [agent] }),
      `Create your Vault on ${v2Network(chain).name}.`,
      undefined,
      undefined,
      reviewedConnector,
    );
    return waitForState(
      () => readVault(signer, chain, receipt.blockNumber),
      (address) => address !== zeroAddress,
      { chain, hash: receipt.transactionHash },
    );
  }

  const getVaultAgent = (vault: Address) =>
    unichainPublicClient.readContract({
      address: vault,
      abi: workflowVaultV2Abi,
      functionName: 'agent',
    });
  const getLink = (agent: Address, blockNumber?: bigint) =>
    lasna.readContract({
      address: agent,
      abi: workflowAgentV2Abi,
      functionName: 'vaults',
      args: [UNICHAIN_SEPOLIA_CHAIN_ID],
      blockNumber,
    });

  async function linkVault(agent: Address, vault: Address, reviewedConnector?: string) {
    const chain = UNICHAIN_SEPOLIA_CHAIN_ID;
    const linked = await getLink(agent);
    if (linked !== zeroAddress) {
      if (isAddressEqual(linked, vault)) return;
      throw new Error('This testnet Agent is already linked to another Vault.');
    }
    const receipt = await send(
      LASNA_CHAIN_ID,
      agent,
      encodeFunctionData({
        abi: workflowAgentV2Abi,
        functionName: 'linkVault',
        args: [chain, vault],
      }),
      `Link your ${v2Network(chain).name} Vault to Lasna.`,
      undefined,
      undefined,
      reviewedConnector,
    );
    await waitForState(
      () => getLink(agent, receipt.blockNumber),
      (address) => isAddressEqual(address, vault),
      { chain: LASNA_CHAIN_ID, hash: receipt.transactionHash },
    );
  }

  async function ensure(signer: Address, chain: SettlementChain) {
    const [existingAgent, existingVault] = await Promise.all([
      readAgent(signer),
      readVault(signer, chain),
    ]);
    const agent = existingAgent === zeroAddress ? await createAgent(signer) : existingAgent;
    const vault = existingVault === zeroAddress ? await createVault(signer, agent) : existingVault;
    if (existingVault !== zeroAddress && !isAddressEqual(await getVaultAgent(vault), agent))
      throw new Error('This testnet Vault is linked to another Agent.');
    await linkVault(agent, vault);
    return { agent, vault };
  }

  const setupWallet: SetupWallet = {
    getAgent: async (signer) => {
      const agent = await readAgent(signer);
      return agent === zeroAddress ? null : agent;
    },
    getVault: async (signer) => {
      const vault = await readVault(signer, UNICHAIN_SEPOLIA_CHAIN_ID);
      return vault === zeroAddress ? null : vault;
    },
    getLink: async (agent) => {
      const vault = await getLink(agent);
      return vault === zeroAddress ? null : vault;
    },
    getVaultAgent,
    createAgent,
    createVault,
    linkVault: (_signer, agent, vault, _chain, reviewedConnector) =>
      linkVault(agent, vault, reviewedConnector),
  };

  function activate(
    id: Hex,
    title: string,
    program: WorkflowV2Program,
    budget: WeeklyBudgetAmounts,
  ) {
    return perform(async (signer) => {
      if (!workflowActivationEnabled) throw new Error('New activations are disabled.');
      const chain = program.chain as SettlementChain;
      const client = workflowClient(chain);
      const factory = settlementFactory();
      if (!factory) throw new Error('This testnet deployment is unavailable.');
      const encoded = encodeWorkflowV2(program);
      await validateV2Program(encoded);
      const existingVault = await readVault(signer, chain);
      const { agent, vault } = await ensure(signer, chain);
      // The first activation creates the Vault, so its empty balance cannot block this call.
      // Once a Vault exists, an underfunded balance stops activation before any signatures.
      if (existingVault !== zeroAddress) {
        const funds = await readFundsV2(signer, chain);
        const fundingIssue = workflowFundingIssues(program, budget, funds).find(
          (issue) => issue.code !== 'vault-missing',
        );
        if (fundingIssue) throw new Error(fundingIssue.message);
      }
      const [entry, auth] = await Promise.all([
        v2Entry(agent, id),
        v2Authorization(chain, vault, id),
      ]);
      if (entry[1] > 0n && entry[5] !== chain)
        throw new Error('Create a new workflow to change settlement networks.');
      const hash = keccak256(encoded);
      const stagedBudget = await readWorkflowWeeklyBudget(chain, vault, id);
      // A retry can only reuse a staged authorization whose program and budget both match.
      const staged =
        auth[3] &&
        auth[0] === hash &&
        auth[1] > entry[1] &&
        stagedBudget.usdcLimit === budget.usdc &&
        stagedBudget.wethLimit === budget.weth &&
        title ===
          (await client.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'titles',
            args: [id],
          }));
      const epoch = staged ? auth[1] : (auth[1] > entry[1] ? auth[1] : entry[1]) + 1n;
      if (!staged) {
        if (auth[3])
          await send(
            chain,
            vault,
            encodeFunctionData({
              abi: workflowVaultV2Abi,
              functionName: 'revoke',
              args: [id, auth[1]],
            }),
            'Revoke the earlier workflow authorization.',
          );
        await send(
          chain,
          vault,
          encodeFunctionData({
            abi: workflowVaultV2Abi,
            functionName: 'authorizeWithWeeklyBudget',
            args: [id, epoch, encoded, title, budget.usdc, budget.weth],
          }),
          `Authorize ${title} on ${v2Network(chain).name}.`,
          formatWorkflowCaps(program, budget),
        );
      }
      if (
        program.nodes.some((node) =>
          node.actions.some((step) => step.kind === workflowV2Action.refill),
        )
      ) {
        const token = await client.readContract({
          address: vault,
          abi: workflowVaultV2Abi,
          functionName: 'usdc',
        });
        const allowance = await client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [signer, vault],
        });
        if (allowance < program.usdcCap)
          await send(
            chain,
            token,
            encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [vault, program.usdcCap],
            }),
            'Allow your Vault to pull the configured refill from this wallet.',
            `${formatUnits(program.usdcCap, 6)} USDC total allowance`,
          );
      }
      const confirmed = await waitForState(
        async () => {
          const [state, weekly] = await Promise.all([
            v2Authorization(chain, vault, id),
            readWorkflowWeeklyBudget(chain, vault, id),
          ]);
          return { state, weekly };
        },
        ({ state, weekly }) =>
          state[3] &&
          state[0] === hash &&
          state[1] === epoch &&
          weekly.usdcLimit === budget.usdc &&
          weekly.wethLimit === budget.weth,
      );
      await send(
        LASNA_CHAIN_ID,
        agent,
        encodeFunctionData({
          abi: workflowAgentV2Abi,
          functionName: 'enable',
          args: [id, epoch, encoded, title, confirmed.state[2]],
        }),
        `Enable ${title} on Reactive Lasna.`,
        formatWorkflowCaps(program, budget),
      );
    });
  }

  /** Edits only the weekly limits; the schedule, inactivity window, and recorded spend stay. */
  function setWeeklyBudget(
    item: Pick<Awaited<ReturnType<typeof readWorkflowV2>>, 'chain' | 'vault' | 'id'>,
    usdc: bigint,
    weth: bigint,
  ) {
    return perform(async () => {
      const [auth, staged] = await Promise.all([
        v2Authorization(item.chain, item.vault, item.id),
        readWorkflowWeeklyBudget(item.chain, item.vault, item.id),
      ]);
      if (auth[1] === 0n) throw new Error('Authorize this workflow before editing its budget.');
      await send(
        item.chain,
        item.vault,
        encodeFunctionData({
          abi: workflowVaultV2Abi,
          functionName: 'setWeeklyBudget',
          args: [item.id, auth[1], staged.revision, usdc, weth],
        }),
        'Change the weekly spending budget. Spending already recorded this week still counts.',
        `${weeklyLimitLabel(usdc, 6, 'USDC')} · ${weeklyLimitLabel(weth, 18, 'WETH')}`,
      );
    });
  }

  function pause(item: Awaited<ReturnType<typeof readWorkflowV2>>) {
    return perform(async () => {
      const { chain, agent, vault, id } = item;
      const [entry, auth] = await Promise.all([
        v2Entry(agent, id),
        v2Authorization(chain, vault, id),
      ]);
      if (auth[3])
        await send(
          chain,
          vault,
          encodeFunctionData({
            abi: workflowVaultV2Abi,
            functionName: 'revoke',
            args: [id, auth[1]],
          }),
          'Block new spending for this workflow.',
        );
      if (entry[4] !== 0)
        await send(
          LASNA_CHAIN_ID,
          agent,
          encodeFunctionData({
            abi: workflowAgentV2Abi,
            functionName: 'disable',
            args: [id, entry[1]],
          }),
          'Stop new Lasna callbacks for this workflow.',
        );
    });
  }

  return {
    owner,
    busy,
    status,
    error,
    transaction,
    perform,
    send,
    activate,
    pause,
    setWeeklyBudget,
    setupWallet,
  };
}
