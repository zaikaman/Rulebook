import {
  agentAbi,
  getChain,
  getTemplate,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  type Address,
  type RuleParams,
} from '@rulebook/shared';
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  erc20Abi,
  isAddressEqual,
  zeroAddress,
  type ContractFunctionArgs,
} from 'viem';

import { signatureTokenAmount } from './signatures.js';
import { lasnaPublicClient, unichainPublicClient } from './wagmi.js';

export class RuleFundingError extends Error {
  constructor(
    message: string,
    readonly needsDeposit = false,
  ) {
    super(message);
  }
}

type Spend = Pick<RuleParams, 'chainId' | 'tokenIn' | 'amountIn'> & {
  readonly tokenOut?: Address;
  readonly sourceWallet?: Address;
  readonly incomingMinimum?: bigint;
};

/** Check the account and the funds one invocation could use, at a single funds-side block. */
async function assertFunding(agent: Address, spend: Spend, mirror: boolean): Promise<void> {
  const { chainId, amountIn, tokenIn, tokenOut, sourceWallet } = spend;
  if (chainId !== UNICHAIN_SEPOLIA_CHAIN_ID) {
    throw new RuleFundingError('This rule targets an unsupported funds network.');
  }
  try {
    const [vault, blockNumber] = await Promise.all([
      lasnaPublicClient.readContract({
        address: agent,
        abi: agentAbi,
        functionName: 'getVault',
        args: [BigInt(chainId)],
      }),
      unichainPublicClient.getBlockNumber({ cacheTime: 0 }),
    ]);
    if (vault === zeroAddress) throw new RuleFundingError('Link your vault before continuing.');

    const contract = { address: vault, abi: vaultAbi, blockNumber } as const;
    const read = unichainPublicClient.readContract;
    // The version ties the vault to the same callback envelope as the current Agent release.
    const version = await read({ ...contract, functionName: 'EXECUTION_PAYLOAD_VERSION' }).catch(
      (error: unknown) => {
        if (
          error instanceof BaseError &&
          error.walk(
            (cause) =>
              cause instanceof ContractFunctionRevertedError ||
              cause instanceof ContractFunctionZeroDataError,
          )
        ) {
          throw new RuleFundingError(
            'This vault uses an older contract. Migrate to a vault that can execute rules before adding funds.',
          );
        }
        throw error;
      },
    );
    if (version !== 2) {
      throw new RuleFundingError(
        'This vault uses an incompatible execution contract. Use a vault for the current release.',
      );
    }
    const [boundAgent, paused, mirrorMode, allowedIn, allowedOut, cap] = await Promise.all([
      read({ ...contract, functionName: 'agent' }),
      read({ ...contract, functionName: 'paused' }),
      read({ ...contract, functionName: 'mirrorMode' }),
      read({ ...contract, functionName: 'allowedTokenIn' }),
      tokenOut && read({ ...contract, functionName: 'allowedTokenOut' }),
      read({ ...contract, functionName: 'maxSpendPerRun' }),
    ]);
    if (!isAddressEqual(boundAgent, agent)) {
      throw new RuleFundingError('Your vault is linked to a different automation account.');
    }
    if (paused) throw new RuleFundingError('Unpause your vault before continuing.');
    if (mirrorMode !== mirror) {
      throw new RuleFundingError(mirror ? 'Use a mirror-only vault.' : 'Use a standard vault.');
    }
    if (
      !isAddressEqual(allowedIn, tokenIn) ||
      (tokenOut && allowedOut && !isAddressEqual(allowedOut, tokenOut))
    ) {
      throw new RuleFundingError('This rule uses tokens outside your vault’s allowlist.');
    }
    const tokenAmount = (amount: bigint) => signatureTokenAmount(chainId, tokenIn, amount);
    if (amountIn > cap) {
      throw new RuleFundingError(`Your vault allows up to ${tokenAmount(cap)} per run.`);
    }

    // Income Sweep already receives at least its trigger threshold before the callback is sent.
    const incoming = spend.incomingMinimum ?? 0n;
    if (incoming >= amountIn) return;
    const minimumBalance = amountIn - incoming;
    const token = { address: tokenIn, abi: erc20Abi, blockNumber } as const;
    const [balance, principal, allowance] = await Promise.all([
      read({ ...token, functionName: 'balanceOf', args: [sourceWallet ?? vault] }),
      mirror ? read({ ...contract, functionName: 'principalOf', args: [tokenIn] }) : undefined,
      sourceWallet && read({ ...token, functionName: 'allowance', args: [sourceWallet, vault] }),
    ]);
    // Standard swaps and transfers spend actual ERC-20 balances. Mirrors also enforce recorded principal.
    const available = principal !== undefined && principal < balance ? principal : balance;
    if (available < minimumBalance) {
      const required = tokenAmount(minimumBalance);
      const held = tokenAmount(available);
      throw new RuleFundingError(
        sourceWallet
          ? `The source wallet has ${held}. It needs at least ${required} for one run.`
          : `Your vault has ${held} available. Deposit at least ${tokenAmount(minimumBalance - available)} to cover one run.`,
        !sourceWallet,
      );
    }
    if (allowance !== undefined && allowance < amountIn) {
      throw new RuleFundingError(
        `The source wallet must approve at least ${tokenAmount(amountIn)} for your vault.`,
      );
    }
  } catch (error) {
    if (error instanceof RuleFundingError) throw error;
    throw new RuleFundingError('Vault funding could not be verified on-chain. Try again.');
  }
}

export async function assertRuleFunding(agent: Address, params: RuleParams): Promise<void> {
  const template = getTemplate(params.template);
  if (!template) throw new RuleFundingError('This rule template is unsupported.');
  if (template.action === 'alert') return;
  if (template.action === 'swap') {
    const { pair, usdc, weth } = getChain(params.chainId);
    const forward = isAddressEqual(params.tokenIn, usdc) && isAddressEqual(params.tokenOut, weth);
    const reverse = isAddressEqual(params.tokenIn, weth) && isAddressEqual(params.tokenOut, usdc);
    if (!isAddressEqual(params.pair, pair) || (!forward && !reverse)) {
      throw new RuleFundingError('Use the supported USDC/WETH pool and its tokens for this rule.');
    }
  }
  return assertFunding(
    agent,
    {
      chainId: params.chainId,
      amountIn: params.amountIn,
      tokenIn: params.tokenIn,
      ...(template.action === 'swap' ? { tokenOut: params.tokenOut } : {}),
      ...(template.action === 'transfer_from' ? { sourceWallet: params.pair } : {}),
      ...(template.name === 'IncomeSweep' ? { incomingMinimum: params.threshold } : {}),
    },
    false,
  );
}

export type MirrorConfig = ContractFunctionArgs<typeof agentAbi, 'nonpayable', 'addMirror'>[1];

export async function assertMirrorFunding(agent: Address, config: MirrorConfig): Promise<void> {
  const leader = await lasnaPublicClient
    .readContract({
      address: config.leaderAgent,
      abi: agentAbi,
      functionName: 'getRule',
      args: [config.leaderRuleId],
    })
    .catch(() => {
      throw new RuleFundingError('The leader rule could not be verified on-chain. Try again.');
    });
  // The Agent applies the follower's scale first, then clamps each trade to the cap.
  const scaled = (leader.amountIn * BigInt(config.scaleBps)) / 10_000n;
  const amountIn = scaled < config.perRunCap ? scaled : config.perRunCap;
  if (amountIn === 0n) {
    throw new RuleFundingError('The scale or cap is too low to mirror this trade.');
  }
  if (!isAddressEqual(config.tokenIn, leader.tokenIn)) {
    throw new RuleFundingError('The leader rule uses a different spend token.');
  }
  return assertFunding(
    agent,
    {
      chainId: Number(config.leaderChainId),
      tokenIn: config.tokenIn,
      tokenOut: leader.tokenOut,
      amountIn,
    },
    true,
  );
}
