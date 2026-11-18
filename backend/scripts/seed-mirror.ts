import {
  agentAbi,
  agentFactoryAbi,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  vaultFactoryAbi,
} from '@rulebook/shared';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';

const lasna = getChain(LASNA_CHAIN_ID);
const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
const poolAbi = parseAbi([
  'function sync()',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]);
const creditAbi = parseAbi([
  'function reserves(address target) view returns (uint256)',
  'function depositTo(address target) payable',
]);
const authorizationFields = [
  { name: 'owner', type: 'address' },
  { name: 'agent', type: 'address' },
  { name: 'tokenIn', type: 'address' },
  { name: 'tokenOut', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
] as const;
const LEADER_AMOUNT = 1_000_000n;
const FOLLOWER_CAP = 500_000n;
const SCALE_BPS = 5_000;
const HOUR_CAP = 1;
const address = z
  .string()
  .regex(/^0x[\da-f]{40}$/i)
  .transform((value) => value as Address);
const privateKey = z
  .string()
  .regex(/^0x[\da-f]{64}$/i)
  .transform((value) => value as Hex);
const env = z.object({
  LASNA_RPC_URL: z.string().url(),
  UNICHAIN_RPC_URL: z.string().url(),
  AGENT_FACTORY_ADDRESS: address,
  VAULT_FACTORY_ADDRESS: address,
  MIRROR_LEADER_PRIVATE_KEY: privateKey,
  MIRROR_FOLLOWER_PRIVATE_KEY: privateKey,
  MIRROR_AGENT_RESERVE_WEI: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(BigInt),
  MIRROR_VAULT_RESERVE_WEI: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(BigInt),
});

function walletOn(key: Hex, rpcUrl: string) {
  return createWalletClient({ account: privateKeyToAccount(key), transport: http(rpcUrl) });
}

async function main() {
  const parsed = env.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Missing or invalid demo settings: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  const settings = parsed.data;
  const lasnaRead = createPublicClient({ transport: http(settings.LASNA_RPC_URL) });
  const fundsRead = createPublicClient({ transport: http(settings.UNICHAIN_RPC_URL) });
  const [automationId, fundsId] = await Promise.all([
    lasnaRead.getChainId(),
    fundsRead.getChainId(),
  ]);
  if (automationId !== LASNA_CHAIN_ID || fundsId !== UNICHAIN_SEPOLIA_CHAIN_ID) {
    throw new Error('Use Reactive Lasna and Unichain Sepolia RPC endpoints.');
  }
  // A legacy gas price avoids inflating Lasna's fee estimate past the RPC transaction cap.
  const lasnaGas = async () => ({ gasPrice: (await lasnaRead.getGasPrice()) + 1n });
  const leaderLasna = walletOn(settings.MIRROR_LEADER_PRIVATE_KEY, settings.LASNA_RPC_URL);
  const leaderFunds = walletOn(settings.MIRROR_LEADER_PRIVATE_KEY, settings.UNICHAIN_RPC_URL);
  const followerLasna = walletOn(settings.MIRROR_FOLLOWER_PRIVATE_KEY, settings.LASNA_RPC_URL);
  const followerFunds = walletOn(settings.MIRROR_FOLLOWER_PRIVATE_KEY, settings.UNICHAIN_RPC_URL);
  if (leaderFunds.account.address === followerFunds.account.address) {
    throw new Error('Use two distinct demo wallets.');
  }

  async function confirmed(client: typeof lasnaRead, hash: Hex) {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: client === fundsRead ? 2 : 1,
    });
    if (receipt.status !== 'success') throw new Error(`Demo transaction reverted: ${hash}`);
    return receipt;
  }

  const agentFactory = settings.AGENT_FACTORY_ADDRESS;
  const vaultFactory = settings.VAULT_FACTORY_ADDRESS;
  const ZERO = '0x0000000000000000000000000000000000000000';

  async function deployedAddress(read: () => Promise<Address>): Promise<Address> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const address = await read();
      if (address !== ZERO) return address;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    throw new Error('The confirmed deployment has no visible factory record.');
  }

  async function provision(
    automation: typeof leaderLasna,
    funds: typeof leaderFunds,
    mirror: boolean,
  ) {
    const owner = funds.account.address;
    const readAgent = () =>
      lasnaRead.readContract({
        address: agentFactory,
        abi: agentFactoryAbi,
        functionName: 'agentOf',
        args: [owner],
      });
    const readVault = () =>
      fundsRead.readContract({
        address: vaultFactory,
        abi: vaultFactoryAbi,
        functionName: 'vaultOf',
        args: [owner],
      });
    let agent = await readAgent();
    if (agent === ZERO) {
      await confirmed(
        lasnaRead,
        await automation.writeContract({
          ...(await lasnaGas()),
          chain: null,
          address: agentFactory,
          abi: agentFactoryAbi,
          functionName: 'deploy',
          args: [owner],
        }),
      );
      agent = await deployedAddress(readAgent);
    }
    let vault = await readVault();
    if (vault === ZERO) {
      const nonce = await fundsRead.readContract({
        address: vaultFactory,
        abi: vaultFactoryAbi,
        functionName: 'nonces',
        args: [owner],
      });
      const deadline = (await fundsRead.getBlock()).timestamp + 1_800n;
      const signature = await funds.signTypedData({
        domain: {
          name: 'Rulebook Vault Factory',
          version: '1',
          chainId: fundsId,
          verifyingContract: vaultFactory,
        },
        types: mirror
          ? { MirrorVaultDeployment: authorizationFields }
          : { VaultDeployment: authorizationFields },
        primaryType: mirror ? 'MirrorVaultDeployment' : 'VaultDeployment',
        message: { owner, agent, tokenIn: unichain.usdc, tokenOut: unichain.weth, nonce, deadline },
      });
      await confirmed(
        fundsRead,
        await funds.writeContract({
          chain: null,
          address: vaultFactory,
          abi: vaultFactoryAbi,
          functionName: mirror ? 'deployMirror' : 'deploy',
          args: [owner, agent, unichain.usdc, unichain.weth, deadline, signature],
        }),
      );
      vault = await deployedAddress(readVault);
    }
    const mode = await fundsRead.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'mirrorMode',
    });
    if (mode !== mirror) throw new Error(`Demo vault ${vault} has the wrong immutable mode.`);

    const linked = await lasnaRead.readContract({
      address: agent,
      abi: agentAbi,
      functionName: 'getVault',
      args: [BigInt(fundsId)],
    });
    if (linked === ZERO) {
      await confirmed(
        lasnaRead,
        await automation.writeContract({
          ...(await lasnaGas()),
          chain: null,
          address: agent,
          abi: agentAbi,
          functionName: 'linkVault',
          args: [BigInt(fundsId), vault],
        }),
      );
    } else if (linked.toLowerCase() !== vault.toLowerCase()) {
      throw new Error(`Demo agent ${agent} is linked to a different vault.`);
    }

    const amount = mirror ? FOLLOWER_CAP : LEADER_AMOUNT;
    const principal = await fundsRead.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'principalOf',
      args: [unichain.usdc],
    });
    if (principal < amount) {
      const difference = amount - principal;
      await confirmed(
        fundsRead,
        await funds.writeContract({
          chain: null,
          address: unichain.usdc,
          abi: erc20Abi,
          functionName: 'approve',
          args: [vault, difference],
        }),
      );
      await confirmed(
        fundsRead,
        await funds.writeContract({
          chain: null,
          address: vault,
          abi: vaultAbi,
          functionName: 'deposit',
          args: [unichain.usdc, difference],
        }),
      );
    }

    const agentCredit = await lasnaRead.readContract({
      address: lasna.systemContract,
      abi: creditAbi,
      functionName: 'reserves',
      args: [agent],
    });
    if (agentCredit < settings.MIRROR_AGENT_RESERVE_WEI) {
      await confirmed(
        lasnaRead,
        await automation.writeContract({
          ...(await lasnaGas()),
          chain: null,
          address: lasna.systemContract,
          abi: creditAbi,
          functionName: 'depositTo',
          args: [agent],
          value: settings.MIRROR_AGENT_RESERVE_WEI - agentCredit,
        }),
      );
    }
    const vaultCredit = await fundsRead.readContract({
      address: unichain.callbackProxy,
      abi: creditAbi,
      functionName: 'reserves',
      args: [vault],
    });
    if (vaultCredit < settings.MIRROR_VAULT_RESERVE_WEI) {
      await confirmed(
        fundsRead,
        await funds.writeContract({
          chain: null,
          address: unichain.callbackProxy,
          abi: creditAbi,
          functionName: 'depositTo',
          args: [vault],
          value: settings.MIRROR_VAULT_RESERVE_WEI - vaultCredit,
        }),
      );
    }
    return { agent, vault };
  }

  // Reserve requirements and principal are checked before creating any demo contracts.
  for (const [automation, funds, amount] of [
    [leaderLasna, leaderFunds, LEADER_AMOUNT],
    [followerLasna, followerFunds, FOLLOWER_CAP],
  ] as const) {
    const owner = funds.account.address;
    const [react, eth, usdc, agent, vault] = await Promise.all([
      lasnaRead.getBalance({ address: automation.account.address }),
      fundsRead.getBalance({ address: owner }),
      fundsRead.readContract({
        address: unichain.usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
      }),
      lasnaRead.readContract({
        address: agentFactory,
        abi: agentFactoryAbi,
        functionName: 'agentOf',
        args: [owner],
      }),
      fundsRead.readContract({
        address: vaultFactory,
        abi: vaultFactoryAbi,
        functionName: 'vaultOf',
        args: [owner],
      }),
    ]);
    const [agentCredit, vaultCredit, principal] = await Promise.all([
      agent === ZERO
        ? 0n
        : lasnaRead.readContract({
            address: lasna.systemContract,
            abi: creditAbi,
            functionName: 'reserves',
            args: [agent],
          }),
      vault === ZERO
        ? 0n
        : fundsRead.readContract({
            address: unichain.callbackProxy,
            abi: creditAbi,
            functionName: 'reserves',
            args: [vault],
          }),
      vault === ZERO
        ? 0n
        : fundsRead.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: 'principalOf',
            args: [unichain.usdc],
          }),
    ]);
    if (
      react === 0n ||
      react + agentCredit <= settings.MIRROR_AGENT_RESERVE_WEI ||
      eth === 0n ||
      eth + vaultCredit <= settings.MIRROR_VAULT_RESERVE_WEI ||
      usdc + principal < amount
    ) {
      throw new Error(
        `Fund demo wallet ${owner} with Lasna REACT, Unichain Sepolia ETH, and demo USDC.`,
      );
    }
  }

  const leader = await provision(leaderLasna, leaderFunds, false);
  const follower = await provision(followerLasna, followerFunds, true);
  const nextRule = (agent: Address) =>
    lasnaRead.readContract({
      address: agent,
      abi: agentAbi,
      functionName: 'nextRuleId',
    });
  const leaderRuleId = await nextRule(leader.agent);
  const followerRuleId = await nextRule(follower.agent);
  const [reserveIn, reserveOut] = await fundsRead.readContract({
    address: unichain.pair,
    abi: poolAbi,
    functionName: 'getReserves',
  });
  const threshold = (2n * reserveOut * 10n ** 18n) / reserveIn;
  const secondary = (await lasnaRead.getBlock()).timestamp + 3_600n;
  const leaderRuleTx = await leaderLasna.writeContract({
    ...(await lasnaGas()),
    chain: null,
    address: leader.agent,
    abi: agentAbi,
    functionName: 'addRule',
    args: [
      {
        template: 3,
        chainId: fundsId,
        flags: 0,
        pair: unichain.pair,
        tokenIn: unichain.usdc,
        tokenOut: unichain.weth,
        amountIn: LEADER_AMOUNT,
        threshold,
        secondary,
        lastRun: 0n,
        runs: 0,
      },
      false,
    ],
  });
  await confirmed(lasnaRead, leaderRuleTx);
  const mirrorTx = await followerLasna.writeContract({
    ...(await lasnaGas()),
    chain: null,
    address: follower.agent,
    abi: agentAbi,
    functionName: 'addMirror',
    args: [
      followerRuleId,
      {
        leaderChainId: BigInt(fundsId),
        leaderVault: leader.vault,
        leaderRuleId,
        scaleBps: SCALE_BPS,
        perRunCap: FOLLOWER_CAP,
        hourlyCap: HOUR_CAP,
        leaderAgent: leader.agent,
        tokenIn: unichain.usdc,
      },
    ],
  });
  await confirmed(lasnaRead, mirrorTx);
  // sync() emits the subscribed observation without requiring an unrelated trigger swap.
  const triggerTx = await leaderFunds.writeContract({
    chain: null,
    address: unichain.pair,
    abi: poolAbi,
    functionName: 'sync',
  });
  await confirmed(fundsRead, triggerTx);
  console.log(
    JSON.stringify(
      {
        leader: { ...leader, ruleId: String(leaderRuleId) },
        follower: { ...follower, ruleId: String(followerRuleId) },
        leaderRuleTx,
        mirrorTx,
        triggerTx,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Mirror demo failed.');
  process.exitCode = 1;
});
