import {
  BASE_SEPOLIA_CHAIN_ID,
  decodeWorkflowV2,
  encodeWorkflowV2,
  executionCreditAbi,
  FUNDS_CHAIN_IDS,
  getChain,
  isFundsChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  validateWorkflowV2Program,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowProgramValidatorV2Abi,
  workflowV2Action,
  workflowV2DeploymentSchema,
  workflowV2Trigger,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  workflowV2Limits,
  type FundsChainId,
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
  toFunctionSelector,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { useAccount, useSendTransaction } from 'wagmi';

import type { SetupWallet } from '@/hooks/useAccountSetup';
import type { SetupFundingWallet } from '@/hooks/useAccountFunding';
import { useChainGuard } from '@/hooks/useChainGuard';
import { describeError, formatContractError, SetupTransactionError } from '@/lib/errors';
import { type SignatureDetails } from '@/lib/signatures';
import { basePublicClient, lasnaPublicClient as lasna, unichainPublicClient } from '@/lib/wagmi';
import { workflowFundingIssues } from './fundingV2';

export type SettlementChain = FundsChainId;
type WalletChain = SignatureDetails['chainId'];

function deployment() {
  try {
    return workflowV2DeploymentSchema.parse(
      JSON.parse(import.meta.env.VITE_WORKFLOW_V2_DEPLOYMENT ?? 'null'),
    );
  } catch {
    return undefined;
  }
}

export const workflowV2Deployment = deployment();
export const workflowActivationEnabled = import.meta.env.VITE_WORKFLOW_V2_ACTIVATION === 'true';

export function configuredFundsChains(): readonly SettlementChain[] {
  return FUNDS_CHAIN_IDS.filter(
    (chain) => chain === UNICHAIN_SEPOLIA_CHAIN_ID || Boolean(workflowV2Deployment?.base),
  );
}

export function settlementFactory(chain: SettlementChain = UNICHAIN_SEPOLIA_CHAIN_ID) {
  return chain === BASE_SEPOLIA_CHAIN_ID
    ? workflowV2Deployment?.base?.factory
    : workflowV2Deployment?.unichain.factory;
}

export function workflowClient(chain: WalletChain) {
  if (chain === LASNA_CHAIN_ID) return lasna;
  if (chain === BASE_SEPOLIA_CHAIN_ID) return basePublicClient;
  return unichainPublicClient;
}

export function v2Network(chain: WalletChain) {
  return getChain(chain);
}

export function v2Explorer(chain: number, hash: Hex) {
  if (chain !== LASNA_CHAIN_ID && !isFundsChain(chain)) return undefined;
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

const invalidProgramSelector = toFunctionSelector('InvalidProgram()');

export async function validateV2Program(encoded: Hex, program?: WorkflowV2Program) {
  const resolvedProgram = program ?? decodeWorkflowV2(encoded);
  const chain: SettlementChain = isFundsChain(resolvedProgram.chain)
    ? resolvedProgram.chain
    : UNICHAIN_SEPOLIA_CHAIN_ID;
  const factoryChain: SettlementChain = settlementFactory(chain)
    ? chain
    : UNICHAIN_SEPOLIA_CHAIN_ID;
  const factory = settlementFactory(factoryChain);
  if (!factory) return;
  const client = workflowClient(factoryChain);
  const validator = await client.readContract({
    address: factory,
    abi: workflowVaultFactoryV2Abi,
    functionName: 'validator',
  });
  try {
    await client.readContract({
      address: validator,
      abi: workflowProgramValidatorV2Abi,
      functionName: 'validateProgram',
      args: [encoded],
    });
  } catch (cause) {
    const described = describeError(cause);
    if (described?.selector === invalidProgramSelector) {
      validateWorkflowV2Program(resolvedProgram);
      throw new Error(described.message, { cause });
    }
    throw cause;
  }
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
  const factory = settlementFactory(chain);
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

async function workflowVersion(
  agent: Address,
  vault: Address,
  id: Hex,
  chain: SettlementChain,
  preloadedEntry?: Awaited<ReturnType<typeof v2Entry>>,
) {
  const client = workflowClient(chain);
  const [entry, auth] = await Promise.all([
    preloadedEntry ?? v2Entry(agent, id),
    v2Authorization(chain, vault, id),
  ]);
  if (entry[1] === 0n && auth[1] === 0n)
    throw new Error('This workflow was not found for the connected wallet.');
  const staged = auth[1] > entry[1] && (auth[3] || entry[1] === 0n);
  const title = staged
    ? await client.readContract({
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
  const partiallyPaused = !active && entry[4] !== 0 && !auth[3];
  return { agent, vault, id, chain, entry, auth, title, active, staged, partiallyPaused } as const;
}

async function readWorkflowVersionDetails(item: Awaited<ReturnType<typeof workflowVersion>>) {
  const client = workflowClient(item.chain);
  const [program, memory, budget] = await Promise.all([
    item.staged
      ? client.readContract({
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
    client.readContract({
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
  const chains = configuredFundsChains();
  const [agent, ...vaultList] = await Promise.all([
    readAgent(owner),
    ...chains.map((chain) => readVault(owner, chain)),
  ]);
  if (agent === zeroAddress) return [];
  const deployed = chains
    .map((chain, index) => ({ chain, vault: vaultList[index] ?? zeroAddress }))
    .filter((item) => item.vault !== zeroAddress);
  if (!deployed.length) return [];
  const perChain = await Promise.all(
    deployed.map(async ({ chain, vault }) => ({
      chain,
      vault,
      ids: await workflowClient(chain).readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'workflowIds',
      }),
    })),
  );
  const items = perChain.flatMap(({ chain, vault, ids }) =>
    ids
      .slice()
      .reverse()
      .map((id) => ({ chain, vault, id })),
  );
  const seen = new Set<string>();
  const unique = items.filter(({ id }) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return Promise.all(
    unique.map(async ({ chain, vault, id }) =>
      readWorkflowVersionDetails(await workflowVersion(agent, vault, id, chain)),
    ),
  );
}

/** Number of workflows currently enabled on the wallet's Agent, the array `MAX_ACTIVE` bounds. */
export async function readActiveWorkflowCount(owner: Address) {
  const agent = await readAgent(owner);
  if (agent === zeroAddress) return 0;
  const ids = await lasna.readContract({
    address: agent,
    abi: workflowAgentV2Abi,
    functionName: 'workflowIds',
  });
  const entries = await Promise.all(ids.map((id) => v2Entry(agent, id)));
  return entries.filter((entry) => entry[4] !== 0).length;
}

export interface ActivePaymentWorkflow {
  readonly id: Hex;
  readonly title?: string;
}

export function paymentWorkflowConflictMessage(existingTitle?: string) {
  return `This Vault already has an active Vault receives USDC workflow${existingTitle ? ` (${existingTitle})` : ''}. Pause or complete it before activating another.`;
}

async function readPaymentWorkflowFromVault(
  chain: SettlementChain,
  vault: Address,
): Promise<ActivePaymentWorkflow | null> {
  if (vault === zeroAddress) return null;
  const client = workflowClient(chain);
  const id = await client.readContract({
    address: vault,
    abi: workflowVaultV2Abi,
    functionName: 'paymentWorkflow',
  });
  if (id === zeroHash) return null;
  const title = await client
    .readContract({
      address: vault,
      abi: workflowVaultV2Abi,
      functionName: 'titles',
      args: [id],
    })
    .catch(() => undefined);
  return { id, title: title || undefined };
}

/**
 * Returns the workflow currently occupying `WorkflowVaultV2.paymentWorkflow`, or null when the
 * wallet has no Vault or no active/staged payment-trigger workflow.
 */
export async function readPaymentWorkflow(
  owner: Address,
  chain: SettlementChain,
): Promise<ActivePaymentWorkflow | null> {
  const vault = await readVault(owner, chain);
  return readPaymentWorkflowFromVault(chain, vault);
}

export async function readWorkflowV2(owner: Address, id: Hex) {
  const chains = configuredFundsChains();
  const [agent, ...vaultList] = await Promise.all([
    readAgent(owner),
    ...chains.map((chain) => readVault(owner, chain)),
  ]);
  const deployed = chains
    .map((chain, index) => ({ chain, vault: vaultList[index] ?? zeroAddress }))
    .filter((item) => item.vault !== zeroAddress);
  if (agent === zeroAddress || !deployed.length)
    throw new Error('This wallet has no workflow account.');
  const entry = await v2Entry(agent, id);
  const entryChain = isFundsChain(entry[5]) ? entry[5] : undefined;
  const preferred = entryChain ? deployed.find((item) => item.chain === entryChain) : undefined;
  if (preferred) {
    return readWorkflowVersionDetails(
      await workflowVersion(agent, preferred.vault, id, preferred.chain, entry),
    );
  }
  for (const item of deployed) {
    const auth = await v2Authorization(item.chain, item.vault, id);
    if (auth[1] !== 0n || auth[3]) {
      return readWorkflowVersionDetails(
        await workflowVersion(agent, item.vault, id, item.chain, entry),
      );
    }
  }
  throw new Error('This workflow was not found for the connected wallet.');
}

export async function readFundsV2(owner: Address, chain: SettlementChain) {
  const [agent, vault] = await Promise.all([readAgent(owner), readVault(owner, chain)]);
  const client = workflowClient(chain);
  const lasnaSystem = getChain(LASNA_CHAIN_ID).systemContract;
  const factory = settlementFactory(chain);
  const proxy = factory
    ? await client.readContract({
        address: factory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'callbackProxy',
      })
    : undefined;
  const [usdc, weth, watch, execution, native, agentNative, walletNative, walletWatch] =
    await Promise.all([
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
      agent === zeroAddress ? 0n : lasna.getBalance({ address: agent }),
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
    agentNative,
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
      setError(formatContractError(cause, 'The wallet request failed.'));
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

  async function createVault(
    signer: Address,
    agent: Address,
    reviewedConnector?: string,
    _mode?: 'mirror',
    chain: SettlementChain = UNICHAIN_SEPOLIA_CHAIN_ID,
  ) {
    const vaultFactory = settlementFactory(chain);
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

  const getVaultAgent = (vault: Address, chain: SettlementChain = UNICHAIN_SEPOLIA_CHAIN_ID) =>
    workflowClient(chain).readContract({
      address: vault,
      abi: workflowVaultV2Abi,
      functionName: 'agent',
    });
  const getLink = (
    agent: Address,
    chain: SettlementChain = UNICHAIN_SEPOLIA_CHAIN_ID,
    blockNumber?: bigint,
  ) =>
    lasna.readContract({
      address: agent,
      abi: workflowAgentV2Abi,
      functionName: 'vaults',
      args: [chain],
      blockNumber,
    });

  async function linkVault(
    agent: Address,
    vault: Address,
    chain: SettlementChain = UNICHAIN_SEPOLIA_CHAIN_ID,
    reviewedConnector?: string,
  ) {
    const linked = await getLink(agent, chain);
    if (linked !== zeroAddress) {
      if (isAddressEqual(linked, vault)) return;
      throw new Error(
        `This testnet Agent is already linked to another ${v2Network(chain).name} Vault.`,
      );
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
      () => getLink(agent, chain, receipt.blockNumber),
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
    const vault =
      existingVault === zeroAddress
        ? await createVault(signer, agent, undefined, undefined, chain)
        : existingVault;
    if (existingVault !== zeroAddress && !isAddressEqual(await getVaultAgent(vault, chain), agent))
      throw new Error('This testnet Vault is linked to another Agent.');
    await linkVault(agent, vault, chain);
    return { agent, vault };
  }

  function setupWalletForChain(chain: SettlementChain): SetupWallet {
    return {
      getAgent: async (signer) => {
        const agent = await readAgent(signer);
        return agent === zeroAddress ? null : agent;
      },
      getVault: async (signer) => {
        const vault = await readVault(signer, chain);
        return vault === zeroAddress ? null : vault;
      },
      getLink: async (agent) => {
        const vault = await getLink(agent, chain);
        return vault === zeroAddress ? null : vault;
      },
      getVaultAgent: (vault) => getVaultAgent(vault, chain),
      createAgent,
      createVault: (signer, agent, reviewedConnector, mode) =>
        createVault(signer, agent, reviewedConnector, mode, chain),
      linkVault: (_signer, agent, vault, targetChain, reviewedConnector) =>
        linkVault(agent, vault, isFundsChain(targetChain) ? targetChain : chain, reviewedConnector),
    };
  }
  const setupWallet: SetupWallet = setupWalletForChain(UNICHAIN_SEPOLIA_CHAIN_ID);

  function fundingWalletForChain(_chain: SettlementChain): SetupFundingWallet {
    return {
      readFunds: (_signer, targetChain) => readFundsV2(_signer, targetChain),
      depositWatchingCredit: async (_signer, agent, systemContract, amount, reviewedConnector) => {
        const receipt = await send(
          LASNA_CHAIN_ID,
          systemContract,
          encodeFunctionData({
            abi: executionCreditAbi,
            functionName: 'depositTo',
            args: [agent],
          }),
          'Deposit lREACT as watching credit on Reactive Lasna.',
          `${formatUnits(amount, 18)} lREACT`,
          amount,
          reviewedConnector,
        );
        return receipt.transactionHash;
      },
      depositExecutionCredit: async (
        _signer,
        vault,
        proxy,
        targetChain,
        amount,
        reviewedConnector,
      ) => {
        const receipt = await send(
          targetChain,
          proxy,
          encodeFunctionData({
            abi: executionCreditAbi,
            functionName: 'depositTo',
            args: [vault],
          }),
          `Deposit ETH as execution credit on ${v2Network(targetChain).name}.`,
          `${formatUnits(amount, 18)} ETH`,
          amount,
          reviewedConnector,
        );
        return receipt.transactionHash;
      },
      depositUsdc: async (_signer, vault, usdc, targetChain, amount, reviewedConnector) => {
        const receipt = await send(
          targetChain,
          usdc,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [vault, amount],
          }),
          `Deposit USDC to your ${v2Network(targetChain).name} Vault.`,
          `${formatUnits(amount, 6)} USDC`,
          0n,
          reviewedConnector,
        );
        return receipt.transactionHash;
      },
    };
  }
  const fundingWallet: SetupFundingWallet = fundingWalletForChain(UNICHAIN_SEPOLIA_CHAIN_ID);

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
      const factory = settlementFactory(chain);
      if (!factory) throw new Error('This testnet deployment is unavailable.');
      const encoded = encodeWorkflowV2(program);
      await validateV2Program(encoded, program);
      const existingVault = await readVault(signer, chain);
      if (existingVault !== zeroAddress && program.trigger === workflowV2Trigger.payment) {
        const activePayment = await readPaymentWorkflowFromVault(chain, existingVault);
        if (activePayment && activePayment.id.toLowerCase() !== id.toLowerCase()) {
          throw new Error(paymentWorkflowConflictMessage(activePayment.title));
        }
      }
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
      // Enabling the same active workflow frees its own slot first; only a new slot can exceed
      // the cap. Check before any wallet prompt so the fifth workflow never costs a signature.
      if (
        entry[4] === 0 &&
        (await readActiveWorkflowCount(signer)) >= workflowV2Limits.activePerAgent
      ) {
        throw new Error(
          `This wallet already has ${workflowV2Limits.activePerAgent} active workflows, the most one Agent can watch at once. Pause or complete one before activating another.`,
        );
      }
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

  function ensureVault(chain: SettlementChain) {
    return perform(async (signer) => {
      await ensure(signer, chain);
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
    ensureVault,
    setupWallet,
    setupWalletForChain,
    fundingWallet,
    fundingWalletForChain,
  };
}
