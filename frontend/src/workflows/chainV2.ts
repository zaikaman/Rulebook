import {
  automationChainFor,
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  decodeWorkflowV2,
  defaultFundsChainFor,
  encodeWorkflowV2,
  executionCreditAbi,
  getChain,
  isAutomationChain,
  isFundsChain,
  networkModeForChain,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  validateWorkflowV2Program,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowHealthKey,
  workflowProgramValidatorV2Abi,
  workflowV2Action,
  workflowV2Trigger,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  workflowV2Limits,
  type FundsChainId,
  type NetworkMode,
  type SupportedChainId,
  type WeeklyBudgetAmounts,
  type WorkflowV2Program,
} from '@rulebook/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
import {
  configuredFundsChainsFor,
  parseWorkflowV2TestnetDeployment,
  resolveWorkflowV2Deployment,
} from '@/lib/contracts';
import { describeError, formatContractError, SetupTransactionError } from '@/lib/errors';
import { useNetworkMode } from '@/lib/networkMode';
import { type SignatureDetails } from '@/lib/signatures';
import { publicClientFor } from '@/lib/wagmi';
import { workflowFundingIssues } from './fundingV2';

export type SettlementChain = FundsChainId;
type WalletChain = SupportedChainId | SignatureDetails['chainId'];

export const workflowV2Deployment = parseWorkflowV2TestnetDeployment();
export const workflowActivationEnabled = import.meta.env.VITE_WORKFLOW_V2_ACTIVATION === 'true';

export function workflowV2DeploymentFor(mode: NetworkMode = 'testnet') {
  return resolveWorkflowV2Deployment(mode);
}

export function configuredFundsChains(mode: NetworkMode = 'testnet'): readonly SettlementChain[] {
  return configuredFundsChainsFor(mode, workflowV2DeploymentFor(mode));
}

export function settlementFactory(chain: SettlementChain = UNICHAIN_SEPOLIA_CHAIN_ID) {
  const dep = workflowV2DeploymentFor(networkModeForChain(chain));
  return chain === BASE_SEPOLIA_CHAIN_ID || chain === BASE_MAINNET_CHAIN_ID
    ? dep?.base?.factory
    : dep?.unichain.factory;
}

export function workflowClient(chain: WalletChain) {
  return publicClientFor(chain);
}

export function v2Network(chain: WalletChain) {
  return getChain(chain);
}

export function v2Explorer(chain: number, hash: Hex) {
  if (!isAutomationChain(chain) && !isFundsChain(chain)) return undefined;
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
  const mode = networkModeForChain(
    isFundsChain(resolvedProgram.chain) ? resolvedProgram.chain : UNICHAIN_SEPOLIA_CHAIN_ID,
  );
  const fallbackChain = defaultFundsChainFor(mode);
  const chain: SettlementChain = isFundsChain(resolvedProgram.chain)
    ? resolvedProgram.chain
    : fallbackChain;
  const factoryChain: SettlementChain = settlementFactory(chain) ? chain : fallbackChain;
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

export async function readAgent(
  owner: Address,
  blockNumber?: bigint,
  mode: NetworkMode = 'testnet',
) {
  const dep = workflowV2DeploymentFor(mode);
  const factory = dep?.automationFactory;
  const client = workflowClient(automationChainFor(mode));
  return factory
    ? client.readContract({
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

export function v2Entry(agent: Address, id: Hex, mode: NetworkMode = 'testnet') {
  return workflowClient(automationChainFor(mode)).readContract({
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
  const mode = networkModeForChain(chain);
  const autoClient = workflowClient(automationChainFor(mode));
  const client = workflowClient(chain);
  const [rawEntry, auth] = await Promise.all([
    preloadedEntry ?? v2Entry(agent, id, mode),
    v2Authorization(chain, vault, id),
  ]);
  const entryMatchesChain = rawEntry[5] === chain;
  const entry = (
    entryMatchesChain ? rawEntry : [zeroHash, 0n, 0n, 0n, 0, chain, 0n, 0n]
  ) as Awaited<ReturnType<typeof v2Entry>>;
  if (entry[1] === 0n && auth[1] === 0n)
    throw new Error('This workflow was not found for the connected wallet.');
  const staged = entryMatchesChain
    ? auth[1] > entry[1] && (auth[3] || entry[1] === 0n)
    : auth[1] > 0n;
  const readFromVault = staged || !entryMatchesChain;
  const title = readFromVault
    ? await client.readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'titles',
        args: [id],
      })
    : await autoClient.readContract({
        address: agent,
        abi: workflowAgentV2Abi,
        functionName: 'titles',
        args: [id],
      });
  const active =
    entryMatchesChain && entry[4] !== 0 && auth[3] && entry[1] === auth[1] && entry[0] === auth[0];
  const partiallyPaused = !active && entryMatchesChain && entry[4] !== 0 && !auth[3];
  return {
    agent,
    vault,
    id,
    chain,
    entry,
    auth,
    title,
    active,
    staged,
    partiallyPaused,
    readFromVault,
  } as const;
}

async function readWorkflowVersionDetails(item: Awaited<ReturnType<typeof workflowVersion>>) {
  const mode = networkModeForChain(item.chain);
  const autoClient = workflowClient(automationChainFor(mode));
  const client = workflowClient(item.chain);
  const [program, memory, budget] = await Promise.all([
    item.readFromVault
      ? client.readContract({
          address: item.vault,
          abi: workflowVaultV2Abi,
          functionName: 'programs',
          args: [item.auth[0]],
        })
      : autoClient.readContract({
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
  return { ...item, program, budget, closed: memory[7], eligibleAt: memory[4] };
}

export interface WorkflowListResultV2 {
  readonly workflows: Awaited<ReturnType<typeof readWorkflowVersionDetails>>[];
  readonly failedChains: SettlementChain[];
}

export async function readWorkflowsV2(
  owner: Address,
  mode: NetworkMode = 'testnet',
): Promise<WorkflowListResultV2> {
  const chains = configuredFundsChains(mode);
  const [agent, vaultResults] = await Promise.all([
    readAgent(owner, undefined, mode),
    Promise.allSettled(chains.map((chain) => readVault(owner, chain))),
  ]);
  if (agent === zeroAddress) return { workflows: [], failedChains: [] };
  const failedSet = new Set<SettlementChain>();
  const deployed: Array<{ chain: SettlementChain; vault: Address }> = [];
  chains.forEach((chain, index) => {
    const result = vaultResults[index];
    if (!result || result.status === 'rejected') {
      failedSet.add(chain);
      return;
    }
    if (result.value !== zeroAddress) {
      deployed.push({ chain, vault: result.value });
    }
  });
  if (!deployed.length) {
    return { workflows: [], failedChains: chains.filter((chain) => failedSet.has(chain)) };
  }
  const perChainResults = await Promise.allSettled(
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
  const items: Array<{ chain: SettlementChain; vault: Address; id: Hex }> = [];
  perChainResults.forEach((result, index) => {
    const chain = deployed[index]!.chain;
    if (result.status === 'rejected') {
      failedSet.add(chain);
      return;
    }
    for (const id of result.value.ids.slice().reverse()) {
      items.push({ chain: result.value.chain, vault: result.value.vault, id });
    }
  });
  const seen = new Set<string>();
  const unique = items.filter(({ chain, id }) => {
    const key = workflowHealthKey(chain, id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const detailResults = await Promise.allSettled(
    unique.map(async ({ chain, vault, id }) =>
      readWorkflowVersionDetails(await workflowVersion(agent, vault, id, chain)),
    ),
  );
  const workflows: Awaited<ReturnType<typeof readWorkflowVersionDetails>>[] = [];
  detailResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      workflows.push(result.value);
    } else {
      failedSet.add(unique[index]!.chain);
    }
  });
  return {
    workflows,
    failedChains: chains.filter((chain) => failedSet.has(chain)),
  };
}

/** Number of workflows currently enabled on the wallet's Agent, the array `MAX_ACTIVE` bounds. */
export async function readActiveWorkflowCount(owner: Address, mode: NetworkMode = 'testnet') {
  const agent = await readAgent(owner, undefined, mode);
  if (agent === zeroAddress) return 0;
  const autoClient = workflowClient(automationChainFor(mode));
  const ids = await autoClient.readContract({
    address: agent,
    abi: workflowAgentV2Abi,
    functionName: 'workflowIds',
  });
  const entries = await Promise.all(ids.map((id) => v2Entry(agent, id, mode)));
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

export async function readWorkflowV2(
  owner: Address,
  id: Hex,
  mode: NetworkMode = 'testnet',
  preferredChain?: SettlementChain,
) {
  const chains = configuredFundsChains(mode);
  const [agent, vaultResults] = await Promise.all([
    readAgent(owner, undefined, mode),
    Promise.allSettled(chains.map((chain) => readVault(owner, chain))),
  ]);
  if (agent === zeroAddress) throw new Error('This wallet has no workflow account.');
  const failedChains: SettlementChain[] = [];
  const deployed: Array<{ chain: SettlementChain; vault: Address }> = [];
  chains.forEach((chain, index) => {
    const result = vaultResults[index];
    if (!result || result.status === 'rejected') {
      failedChains.push(chain);
      return;
    }
    if (result.value !== zeroAddress) {
      deployed.push({ chain, vault: result.value });
    }
  });
  if (!deployed.length) {
    if (failedChains.length > 0) {
      throw new Error(
        `Could not reach ${failedChains.map((chain) => v2Network(chain).name).join(' or ')} to load this workflow.`,
      );
    }
    throw new Error('This wallet has no workflow account.');
  }
  const entry = await v2Entry(agent, id, mode);
  if (preferredChain) {
    if (failedChains.includes(preferredChain)) {
      throw new Error(`Could not reach ${v2Network(preferredChain).name} to load this workflow.`);
    }
    const explicit = deployed.find((item) => item.chain === preferredChain);
    if (explicit) {
      try {
        const auth = await v2Authorization(explicit.chain, explicit.vault, id);
        if (auth[1] !== 0n || auth[3] || entry[5] === explicit.chain) {
          return await readWorkflowVersionDetails(
            await workflowVersion(agent, explicit.vault, id, explicit.chain, entry),
          );
        }
      } catch (cause) {
        throw new Error(
          `Could not reach ${v2Network(explicit.chain).name} to load this workflow.`,
          { cause },
        );
      }
    }
  }
  const entryChain = isFundsChain(entry[5]) ? entry[5] : undefined;
  if (entryChain && failedChains.includes(entryChain)) {
    throw new Error(`Could not reach ${v2Network(entryChain).name} to load this workflow.`);
  }
  const preferred = entryChain ? deployed.find((item) => item.chain === entryChain) : undefined;
  if (preferred) {
    return readWorkflowVersionDetails(
      await workflowVersion(agent, preferred.vault, id, preferred.chain, entry),
    );
  }
  for (const item of deployed) {
    try {
      const auth = await v2Authorization(item.chain, item.vault, id);
      if (auth[1] !== 0n || auth[3]) {
        return await readWorkflowVersionDetails(
          await workflowVersion(agent, item.vault, id, item.chain, entry),
        );
      }
    } catch {
      failedChains.push(item.chain);
    }
  }
  if (failedChains.length > 0) {
    const failedNames = chains
      .filter((chain) => failedChains.includes(chain))
      .map((chain) => v2Network(chain).name)
      .join(' or ');
    throw new Error(`Could not reach ${failedNames} to load this workflow.`);
  }
  throw new Error('This workflow was not found for the connected wallet.');
}

export async function readFundsV2(owner: Address, chain: SettlementChain) {
  const mode = networkModeForChain(chain);
  const autoChain = automationChainFor(mode);
  const autoClient = workflowClient(autoChain);
  const [agent, vault] = await Promise.all([
    readAgent(owner, undefined, mode),
    readVault(owner, chain),
  ]);
  const client = workflowClient(chain);
  const lasnaSystem = getChain(autoChain).systemContract;
  const factory = settlementFactory(chain);
  const proxy = factory
    ? await client.readContract({
        address: factory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'callbackProxy',
      })
    : undefined;
  const [
    usdc,
    weth,
    watch,
    execution,
    native,
    agentNative,
    walletNative,
    walletWatch,
    linkedVault,
    vaultAgent,
  ] = await Promise.all([
    vault === zeroAddress
      ? zeroAddress
      : client.readContract({ address: vault, abi: workflowVaultV2Abi, functionName: 'usdc' }),
    vault === zeroAddress
      ? zeroAddress
      : client.readContract({ address: vault, abi: workflowVaultV2Abi, functionName: 'weth' }),
    agent === zeroAddress
      ? 0n
      : autoClient.readContract({
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
    agent === zeroAddress ? 0n : autoClient.getBalance({ address: agent }),
    client.getBalance({ address: owner }),
    autoClient.getBalance({ address: owner }),
    agent === zeroAddress
      ? zeroAddress
      : autoClient.readContract({
          address: agent,
          abi: workflowAgentV2Abi,
          functionName: 'vaults',
          args: [chain],
        }),
    vault === zeroAddress
      ? zeroAddress
      : client.readContract({ address: vault, abi: workflowVaultV2Abi, functionName: 'agent' }),
  ]);
  const vaultLinked =
    agent !== zeroAddress &&
    vault !== zeroAddress &&
    linkedVault !== zeroAddress &&
    isAddressEqual(linkedVault, vault) &&
    vaultAgent !== zeroAddress &&
    isAddressEqual(vaultAgent, agent);
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
    linkedVault,
    vaultAgent,
    vaultLinked,
  };
}

export function useWorkflowV2Wallet() {
  const { address: owner } = useAccount();
  const guard = useChainGuard();
  const { sendTransactionAsync } = useSendTransaction();
  const queries = useQueryClient();
  const { mode, automationChainId, automationName, nativeSymbol, defaultFundsChainId, deployment } =
    useNetworkMode();
  const autoClient = workflowClient(automationChainId);
  const locked = useRef(false);
  const prevModeRef = useRef(mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [transaction, setTransaction] = useState<{ chain: WalletChain; hash: Hex }>();

  useEffect(() => {
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    setError(undefined);
    setStatus(undefined);
    setTransaction(undefined);
  }, [mode]);

  async function waitForState<T>(
    read: () => Promise<T>,
    ready: (state: T) => boolean,
    confirmedSetup?: { chain: WalletChain; hash: Hex },
  ) {
    setStatus(`Waiting for the confirmed change on ${mode}.`);
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
          ...(isAutomationChain(chain)
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
    const agentFactory = deployment?.automationFactory;
    if (!agentFactory) throw new Error(`This ${mode} deployment is unavailable.`);
    const receipt = await send(
      automationChainId,
      agentFactory,
      encodeFunctionData({ abi: workflowAgentFactoryV2Abi, functionName: 'create' }),
      `Create your workflow Agent on ${automationName}.`,
      undefined,
      undefined,
      reviewedConnector,
    );
    return waitForState(
      () => readAgent(signer, receipt.blockNumber, mode),
      (address) => address !== zeroAddress,
      { chain: automationChainId, hash: receipt.transactionHash },
    );
  }

  async function createVault(
    signer: Address,
    agent: Address,
    reviewedConnector?: string,
    _mode?: 'mirror',
    chain: SettlementChain = defaultFundsChainId,
  ) {
    const vaultFactory = settlementFactory(chain);
    if (!vaultFactory) throw new Error(`This ${mode} deployment is unavailable.`);
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

  const getVaultAgent = (vault: Address, chain: SettlementChain = defaultFundsChainId) =>
    workflowClient(chain).readContract({
      address: vault,
      abi: workflowVaultV2Abi,
      functionName: 'agent',
    });
  const getLink = (
    agent: Address,
    chain: SettlementChain = defaultFundsChainId,
    blockNumber?: bigint,
  ) =>
    autoClient.readContract({
      address: agent,
      abi: workflowAgentV2Abi,
      functionName: 'vaults',
      args: [chain],
      blockNumber,
    });

  async function linkVault(
    agent: Address,
    vault: Address,
    chain: SettlementChain = defaultFundsChainId,
    reviewedConnector?: string,
  ) {
    const linked = await getLink(agent, chain);
    if (linked !== zeroAddress) {
      if (isAddressEqual(linked, vault)) return;
      throw new Error(
        `This ${mode} Agent is already linked to another ${v2Network(chain).name} Vault.`,
      );
    }
    const receipt = await send(
      automationChainId,
      agent,
      encodeFunctionData({
        abi: workflowAgentV2Abi,
        functionName: 'linkVault',
        args: [chain, vault],
      }),
      `Link your ${v2Network(chain).name} Vault to ${automationName}.`,
      undefined,
      undefined,
      reviewedConnector,
    );
    await waitForState(
      () => getLink(agent, chain, receipt.blockNumber),
      (address) => isAddressEqual(address, vault),
      { chain: automationChainId, hash: receipt.transactionHash },
    );
  }

  async function ensure(signer: Address, chain: SettlementChain) {
    const [existingAgent, existingVault] = await Promise.all([
      readAgent(signer, undefined, mode),
      readVault(signer, chain),
    ]);
    const agent = existingAgent === zeroAddress ? await createAgent(signer) : existingAgent;
    const vault =
      existingVault === zeroAddress
        ? await createVault(signer, agent, undefined, undefined, chain)
        : existingVault;
    if (existingVault !== zeroAddress && !isAddressEqual(await getVaultAgent(vault, chain), agent))
      throw new Error(`This ${mode} Vault is linked to another Agent.`);
    await linkVault(agent, vault, chain);
    return { agent, vault };
  }

  function setupWalletForChain(chain: SettlementChain): SetupWallet {
    return {
      getAgent: async (signer) => {
        const agent = await readAgent(signer, undefined, mode);
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
      createVault: (signer, agent, reviewedConnector, mirrorMode) =>
        createVault(signer, agent, reviewedConnector, mirrorMode, chain),
      linkVault: (_signer, agent, vault, targetChain, reviewedConnector) =>
        linkVault(agent, vault, isFundsChain(targetChain) ? targetChain : chain, reviewedConnector),
    };
  }
  const setupWallet: SetupWallet = setupWalletForChain(defaultFundsChainId);

  function fundingWalletForChain(_chain: SettlementChain): SetupFundingWallet {
    return {
      readFunds: (_signer, targetChain) => readFundsV2(_signer, targetChain),
      depositWatchingCredit: async (_signer, agent, systemContract, amount, reviewedConnector) => {
        const receipt = await send(
          automationChainId,
          systemContract,
          encodeFunctionData({
            abi: executionCreditAbi,
            functionName: 'depositTo',
            args: [agent],
          }),
          `Deposit ${nativeSymbol} as watching credit on ${automationName}.`,
          `${formatUnits(amount, 18)} ${nativeSymbol}`,
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
  const fundingWallet: SetupFundingWallet = fundingWalletForChain(defaultFundsChainId);

  function activate(
    id: Hex,
    title: string,
    program: WorkflowV2Program,
    budget: WeeklyBudgetAmounts,
  ) {
    return perform(async (signer) => {
      if (!workflowActivationEnabled) throw new Error('New activations are disabled.');
      if (networkModeForChain(program.chain) !== mode) {
        throw new Error(
          `Switch to ${networkModeForChain(program.chain)} mode to activate this workflow.`,
        );
      }
      const chain = program.chain as SettlementChain;
      const client = workflowClient(chain);
      const factory = settlementFactory(chain);
      if (!factory) throw new Error(`This ${mode} deployment is unavailable.`);
      const encoded = encodeWorkflowV2(program);
      await validateV2Program(encoded, program);
      const existingVault = await readVault(signer, chain);
      if (existingVault !== zeroAddress && program.trigger === workflowV2Trigger.payment) {
        const activePayment = await readPaymentWorkflowFromVault(chain, existingVault);
        if (activePayment && activePayment.id.toLowerCase() !== id.toLowerCase()) {
          throw new Error(paymentWorkflowConflictMessage(activePayment.title));
        }
      }
      const existingAgent = await readAgent(signer, undefined, mode);
      if (existingAgent === zeroAddress) {
        throw new Error('Complete account setup before activating a workflow.');
      }
      const { agent, vault } = await ensure(signer, chain);
      validateWorkflowV2Program(program, { vault });
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
        v2Entry(agent, id, mode),
        v2Authorization(chain, vault, id),
      ]);
      if (entry[1] > 0n && entry[5] !== chain)
        throw new Error('Create a new workflow to change settlement networks.');
      // Enabling the same active workflow frees its own slot first; only a new slot can exceed
      // the cap. Check before any wallet prompt so the fifth workflow never costs a signature.
      if (
        entry[4] === 0 &&
        (await readActiveWorkflowCount(signer, mode)) >= workflowV2Limits.activePerAgent
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
      const enableData =
        confirmed.state[1] > 1n ||
        confirmed.weekly.usdcLimit > 0n ||
        confirmed.weekly.wethLimit > 0n
          ? encodeFunctionData({
              abi: workflowAgentV2Abi,
              functionName: 'enableWithBudget',
              args: [
                id,
                epoch,
                encoded,
                title,
                confirmed.state[2],
                {
                  usdcLimit: confirmed.weekly.usdcLimit,
                  wethLimit: confirmed.weekly.wethLimit,
                  usdcSpent: confirmed.weekly.usdcSpent,
                  wethSpent: confirmed.weekly.wethSpent,
                  weekStart:
                    confirmed.weekly.resetsAt >= 604_800n
                      ? confirmed.weekly.resetsAt - 604_800n
                      : 0n,
                  revision: confirmed.weekly.revision,
                },
              ],
            })
          : encodeFunctionData({
              abi: workflowAgentV2Abi,
              functionName: 'enable',
              args: [id, epoch, encoded, title, confirmed.state[2]],
            });
      await send(
        automationChainId,
        agent,
        enableData,
        `Enable ${title} on ${automationName}.`,
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
      const itemMode = networkModeForChain(chain);
      const itemAutoChain = automationChainFor(itemMode);
      const [entry, auth] = await Promise.all([
        v2Entry(agent, id, itemMode),
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
          itemAutoChain,
          agent,
          encodeFunctionData({
            abi: workflowAgentV2Abi,
            functionName: 'disable',
            args: [id, entry[1]],
          }),
          `Stop new ${getChain(itemAutoChain).name} callbacks for this workflow.`,
        );
    });
  }

  function ensureVault(chain: SettlementChain) {
    return perform(async (signer) => {
      await ensure(signer, chain);
    });
  }

  const visibleTransaction =
    transaction &&
    (isAutomationChain(transaction.chain) || isFundsChain(transaction.chain)) &&
    networkModeForChain(transaction.chain) === mode
      ? transaction
      : undefined;

  return {
    owner,
    busy,
    status,
    error,
    transaction: visibleTransaction,
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
