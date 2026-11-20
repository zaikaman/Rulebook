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
  type WorkflowV2Program,
} from '@rulebook/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { useAccount, useSendTransaction } from 'wagmi';
import { z } from 'zod';

import { useChainGuard } from '@/hooks/useChainGuard';
import { type SignatureDetails } from '@/lib/signatures';
import { lasnaPublicClient as lasna, unichainPublicClient } from '@/lib/wagmi';

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

export function formatWorkflowCaps(program: WorkflowV2Program) {
  return [
    `${formatUnits(program.usdcCap, 6)} USDC per run`,
    `${formatUnits(program.wethCap, 18)} WETH per run`,
  ].join(', ');
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

export async function readAgent(owner: Address) {
  const factory = workflowV2Deployment?.lasna.factory;
  return factory
    ? lasna.readContract({
        address: factory,
        abi: workflowAgentFactoryV2Abi,
        functionName: 'agentOf',
        args: [owner],
      })
    : zeroAddress;
}

export async function readVault(owner: Address, chain: SettlementChain) {
  const factory = settlementFactory();
  return factory
    ? workflowClient(chain).readContract({
        address: factory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'vaultOf',
        args: [owner],
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
      .map((id) => workflowVersion(agent, vault, id)),
  );
}

export async function readWorkflowV2(owner: Address, id: Hex) {
  const [agent, vault] = await Promise.all([
    readAgent(owner),
    readVault(owner, UNICHAIN_SEPOLIA_CHAIN_ID),
  ]);
  if (agent === zeroAddress || vault === zeroAddress)
    throw new Error('This wallet has no workflow account.');
  const item = await workflowVersion(agent, vault, id);
  const [program, memory] = await Promise.all([
    item.staged
      ? unichainPublicClient.readContract({
          address: vault,
          abi: workflowVaultV2Abi,
          functionName: 'programs',
          args: [item.auth[0]],
        })
      : lasna.readContract({
          address: agent,
          abi: workflowAgentV2Abi,
          functionName: 'programs',
          args: [item.entry[0]],
        }),
    unichainPublicClient.readContract({
      address: vault,
      abi: workflowVaultV2Abi,
      functionName: 'workflowMemory',
      args: [id],
    }),
  ]);
  return { ...item, program, closed: memory[7] };
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
  const [usdc, weth, watch, execution, native] = await Promise.all([
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
  ]);
  const balance = (token: Address) =>
    token === zeroAddress
      ? 0n
      : client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [vault],
        });
  const [stable, wrapped, refillAllowance] = await Promise.all([
    balance(usdc),
    balance(weth),
    usdc === zeroAddress
      ? 0n
      : client.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [owner, vault],
        }),
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

  async function waitForState<T>(read: () => Promise<T>, ready: (state: T) => boolean) {
    setStatus('Waiting for the confirmed change to appear on the testnet.');
    for (let attempt = 0; attempt < 12; attempt++) {
      const state = await read();
      if (ready(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 750));
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
      undefined,
      async () => {
        await client.estimateGas({ account: owner, to: target, data, value });
      },
    );
    setTransaction({ chain, hash });
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
    });
    if (receipt.status !== 'success') throw new Error('The signed transaction reverted.');
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

  async function ensure(signer: Address, chain: SettlementChain) {
    const agentFactory = workflowV2Deployment?.lasna.factory;
    const vaultFactory = settlementFactory();
    if (!agentFactory || !vaultFactory) throw new Error('This testnet deployment is unavailable.');
    let [agent, vault] = await Promise.all([readAgent(signer), readVault(signer, chain)]);
    if (agent === zeroAddress) {
      await send(
        LASNA_CHAIN_ID,
        agentFactory,
        encodeFunctionData({ abi: workflowAgentFactoryV2Abi, functionName: 'create' }),
        'Create your workflow Agent on Reactive Lasna.',
      );
      agent = await waitForState(
        () => readAgent(signer),
        (address) => address !== zeroAddress,
      );
    }
    if (vault === zeroAddress) {
      await send(
        chain,
        vaultFactory,
        encodeFunctionData({
          abi: workflowVaultFactoryV2Abi,
          functionName: 'create',
          args: [agent],
        }),
        `Create your Vault on ${v2Network(chain).name}.`,
      );
      vault = await waitForState(
        () => readVault(signer, chain),
        (address) => address !== zeroAddress,
      );
    }
    const [bound, linked] = await Promise.all([
      workflowClient(chain).readContract({
        address: vault,
        abi: workflowVaultV2Abi,
        functionName: 'agent',
      }),
      lasna.readContract({
        address: agent,
        abi: workflowAgentV2Abi,
        functionName: 'vaults',
        args: [chain],
      }),
    ]);
    if (
      bound.toLowerCase() !== agent.toLowerCase() ||
      (linked !== zeroAddress && linked.toLowerCase() !== vault.toLowerCase())
    )
      throw new Error('This testnet Vault is linked to another Agent or Vault.');
    if (linked === zeroAddress)
      await send(
        LASNA_CHAIN_ID,
        agent,
        encodeFunctionData({
          abi: workflowAgentV2Abi,
          functionName: 'linkVault',
          args: [chain, vault],
        }),
        `Link your ${v2Network(chain).name} Vault to Lasna.`,
      );
    return { agent, vault, vaultFactory };
  }

  function activate(id: Hex, title: string, program: WorkflowV2Program) {
    return perform(async (signer) => {
      if (!workflowActivationEnabled) throw new Error('New activations are disabled.');
      const chain = program.chain as SettlementChain;
      const client = workflowClient(chain);
      const factory = settlementFactory();
      if (!factory) throw new Error('This testnet deployment is unavailable.');
      const encoded = encodeWorkflowV2(program);
      await validateV2Program(encoded);
      const { agent, vault } = await ensure(signer, chain);
      const [entry, auth] = await Promise.all([
        v2Entry(agent, id),
        v2Authorization(chain, vault, id),
      ]);
      if (entry[1] > 0n && entry[5] !== chain)
        throw new Error('Create a new workflow to change settlement networks.');
      const hash = keccak256(encoded);
      const staged =
        auth[3] &&
        auth[0] === hash &&
        auth[1] > entry[1] &&
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
            functionName: 'authorize',
            args: [id, epoch, encoded, title],
          }),
          `Authorize ${title} on ${v2Network(chain).name}.`,
          formatWorkflowCaps(program),
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
        () => v2Authorization(chain, vault, id),
        (state) => state[3] && state[0] === hash && state[1] === epoch,
      );
      await send(
        LASNA_CHAIN_ID,
        agent,
        encodeFunctionData({
          abi: workflowAgentV2Abi,
          functionName: 'enable',
          args: [id, epoch, encoded, title, confirmed[2]],
        }),
        `Enable ${title} on Reactive Lasna.`,
        formatWorkflowCaps(program),
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

  return { owner, busy, status, error, transaction, perform, send, activate, pause, ensure };
}
