/**
 * Live Workflow V2 smoke evidence.
 *
 * Creates (or reuses) the deploying wallet's Agent and Vault on the factories recorded in
 * `deployments/workflows-v2.json`, activates the shipped income-sweep recipe and a scheduled
 * buy, and writes every origin, Lasna decision, and destination settlement receipt to
 * `deployments/workflows-v2-smoke.json`.
 *
 * Env: LASNA_RPC_URL, UNICHAIN_RPC_URL, DEPLOYER_PRIVATE_KEY.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import {
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  executionCreditAbi,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  type SupportedChainId,
  type WorkflowV2Program,
} from '@rulebook/shared';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  http,
  isAddress,
  keccak256,
  parseEther,
  parseUnits,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('Set ' + name + ' before running the live smoke.');
  return value;
}

function connection<T extends SupportedChainId>(id: T, rpc: string, symbol: string) {
  const config = getChain(id);
  const chain = defineChain({
    id,
    name: config.name,
    testnet: true,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const transport = http(rpc, { timeout: 20_000 });
  return { chain, transport, public: createPublicClient({ chain, transport }), config };
}

const lasna = connection(LASNA_CHAIN_ID, env('LASNA_RPC_URL'), 'lREACT');
const uni = connection(UNICHAIN_SEPOLIA_CHAIN_ID, env('UNICHAIN_RPC_URL'), 'ETH');
const key = env('DEPLOYER_PRIVATE_KEY');
const owner = privateKeyToAccount((key.startsWith('0x') ? key : '0x' + key) as Hex);

const records: { contract: string; chainId: number; address: Address; commit: string }[] =
  JSON.parse(await readFile(new URL('../deployments/workflows-v2.json', import.meta.url), 'utf8'));
function factory(contract: string, chainId: number) {
  const entry = records.find((item) => item.contract === contract && item.chainId === chainId);
  if (!entry || !isAddress(entry.address)) throw new Error('Missing deployment record ' + contract);
  return entry.address;
}
const agentFactory = factory('WorkflowAgentFactoryV2', LASNA_CHAIN_ID);
const vaultFactory = factory('WorkflowVaultFactoryV2', UNICHAIN_SEPOLIA_CHAIN_ID);

async function send(
  network: typeof lasna | typeof uni,
  to: Address,
  data?: Hex,
  value = 0n,
): Promise<{ transactionHash: Hex; blockNumber: bigint }> {
  const wallet = createWalletClient({
    chain: network.chain,
    transport: network.transport,
    account: owner,
  });
  // Lasna only accepts legacy-priced transactions; the node rejects EIP-1559 fees.
  const fees =
    network.chain.id === LASNA_CHAIN_ID
      ? { gasPrice: (await network.public.getGasPrice()) * 2n + 1n }
      : {};
  const hash = await wallet.sendTransaction({ to, data, value, ...fees });
  const receipt = await network.public.waitForTransactionReceipt({
    hash,
    confirmations: 2,
    timeout: 120_000,
  });
  if (receipt.status !== 'success') throw new Error('Testnet transaction reverted ' + hash);
  return { transactionHash: hash, blockNumber: receipt.blockNumber };
}

async function setup() {
  let agent = await lasna.public.readContract({
    address: agentFactory,
    abi: workflowAgentFactoryV2Abi,
    functionName: 'agentOf',
    args: [owner.address],
  });
  if (agent === zeroAddress) {
    await send(
      lasna,
      agentFactory,
      encodeFunctionData({ abi: workflowAgentFactoryV2Abi, functionName: 'create' }),
    );
    agent = await lasna.public.readContract({
      address: agentFactory,
      abi: workflowAgentFactoryV2Abi,
      functionName: 'agentOf',
      args: [owner.address],
    });
  }
  let vault = await uni.public.readContract({
    address: vaultFactory,
    abi: workflowVaultFactoryV2Abi,
    functionName: 'vaultOf',
    args: [owner.address],
  });
  if (vault === zeroAddress) {
    await send(
      uni,
      vaultFactory,
      encodeFunctionData({
        abi: workflowVaultFactoryV2Abi,
        functionName: 'create',
        args: [agent],
      }),
    );
    vault = await uni.public.readContract({
      address: vaultFactory,
      abi: workflowVaultFactoryV2Abi,
      functionName: 'vaultOf',
      args: [owner.address],
    });
  }
  const linked = await lasna.public.readContract({
    address: agent,
    abi: workflowAgentV2Abi,
    functionName: 'vaults',
    args: [UNICHAIN_SEPOLIA_CHAIN_ID],
  });
  if (linked === zeroAddress) {
    await send(
      lasna,
      agent,
      encodeFunctionData({
        abi: workflowAgentV2Abi,
        functionName: 'linkVault',
        args: [UNICHAIN_SEPOLIA_CHAIN_ID, vault],
      }),
    );
  } else if (linked.toLowerCase() !== vault.toLowerCase()) {
    throw new Error('The Agent is linked to a different Vault.');
  }
  for (const [network, service, target, amount] of [
    [lasna, lasna.config.systemContract, agent, parseEther('0.4')],
    [uni, uni.config.callbackProxy, vault, parseEther('0.00035')],
  ] as const) {
    const reserve = await network.public.readContract({
      address: service,
      abi: executionCreditAbi,
      functionName: 'reserves',
      args: [target],
    });
    if (reserve < amount) {
      await send(
        network,
        service,
        encodeFunctionData({
          abi: executionCreditAbi,
          functionName: 'depositTo',
          args: [target],
        }),
        amount - reserve,
      );
    }
  }
  return { agent, vault };
}

const statuses: Record<number, string> = {
  0: 'none',
  1: 'confirmed',
  2: 'skipped',
  3: 'expired',
  4: 'failed',
  5: 'unconfirmed',
  6: 'in grace period',
};
const dispatched = getAbiItem({ abi: workflowAgentV2Abi, name: 'Dispatched' });
const outcome = getAbiItem({ abi: workflowVaultV2Abi, name: 'Outcome' });
const step = getAbiItem({ abi: workflowVaultV2Abi, name: 'Step' });

const { agent, vault } = await setup();
const recipient = owner.address;

async function activate(program: WorkflowV2Program, title: string, weeklyUsdc: bigint) {
  const encoded = encodeWorkflowV2(program);
  const hash = keccak256(encoded);
  const id = keccak256(randomBytes(32));
  const auth = await uni.public.readContract({
    address: vault,
    abi: workflowVaultV2Abi,
    functionName: 'authorizations',
    args: [id],
  });
  const epoch = auth[1] + 1n;
  const args = [id, epoch, encoded, title, weeklyUsdc, 0n] as const;
  await uni.public.simulateContract({
    address: vault,
    abi: workflowVaultV2Abi,
    functionName: 'authorizeWithWeeklyBudget',
    args,
    account: owner,
  });
  const authorized = await send(
    uni,
    vault,
    encodeFunctionData({
      abi: workflowVaultV2Abi,
      functionName: 'authorizeWithWeeklyBudget',
      args,
    }),
  );
  const confirmed = await uni.public.readContract({
    address: vault,
    abi: workflowVaultV2Abi,
    functionName: 'authorizations',
    args: [id],
  });
  await send(
    lasna,
    agent,
    encodeFunctionData({
      abi: workflowAgentV2Abi,
      functionName: 'enable',
      args: [id, epoch, encoded, title, confirmed[2]],
    }),
  );
  const window = {
    lasna: await lasna.public.getBlockNumber(),
    uni: await uni.public.getBlockNumber(),
  };
  return { id, hash, authorized, title, window };
}

type Workflow = Awaited<ReturnType<typeof activate>>;

async function finish(
  label: string,
  decision: { transactionHash: Hex; args: { runId: Hex; originTransaction: Hex } },
  settled: { transactionHash: Hex; blockNumber: bigint; args: { status: number; path: number } },
  expectedPath: number,
  expectedStatus: number,
) {
  if (settled.args.path !== expectedPath) throw new Error(label + ' took the wrong path.');
  if (settled.args.status !== expectedStatus)
    throw new Error(label + ' settled as ' + statuses[settled.args.status] + '.');
  const steps = await uni.public.getLogs({
    address: vault,
    event: step,
    args: { runId: decision.args.runId },
    fromBlock: settled.blockNumber,
    toBlock: settled.blockNumber,
    strict: true,
  });
  const spent = steps.reduce((total, entry) => total + (entry.args.spent ?? 0n), 0n);
  const run = {
    spentUsdcBaseUnits: spent.toString(),
    runId: decision.args.runId,
    path: settled.args.path,
    status: statuses[settled.args.status],
    originTransaction: decision.args.originTransaction,
    lasnaTransaction: decision.transactionHash,
    destinationTransaction: settled.transactionHash,
  };
  process.stdout.write(label + ' ' + JSON.stringify(run) + '\n');
  return run;
}

/** Waits for one dispatch of a workflow, then for its settlement on Unichain. */
async function proof(
  label: string,
  workflow: Workflow,
  expectedPath: number,
  expectedStatus: number,
  origin?: Hex,
) {
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    const decisions = await lasna.public.getLogs({
      address: agent,
      event: dispatched,
      args: { workflow: workflow.id },
      fromBlock: workflow.window.lasna,
      toBlock: 'latest',
      strict: true,
    });
    const match = origin
      ? decisions.find(
          (event) => event.args.originTransaction?.toLowerCase() === origin.toLowerCase(),
        )
      : decisions[0];
    if (!match) {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      continue;
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const settled = await uni.public.getLogs({
        address: vault,
        event: outcome,
        args: { runId: match.args.runId },
        fromBlock: workflow.window.uni,
        toBlock: 'latest',
        strict: true,
      });
      if (settled.length) return finish(label, match, settled[0], expectedPath, expectedStatus);
      await new Promise((resolve) => setTimeout(resolve, 6_000));
    }
    throw new Error(label + ' dispatched but never settled.');
  }
  throw new Error(label + ' was not dispatched within the live observation window.');
}

// A Vault authorizes one payment workflow at a time; retire the previous one before a rerun.
const activePayment = await uni.public.readContract({
  address: vault,
  abi: workflowVaultV2Abi,
  functionName: 'paymentWorkflow',
});
if (activePayment !== zeroHash) {
  const previous = await uni.public.readContract({
    address: vault,
    abi: workflowVaultV2Abi,
    functionName: 'authorizations',
    args: [activePayment],
  });
  await send(
    uni,
    vault,
    encodeFunctionData({
      abi: workflowVaultV2Abi,
      functionName: 'revoke',
      args: [activePayment, previous[1]],
    }),
  );
}

const sweepProgram = createWorkflowV2Recipe('income-sweep', {
  minimumPaymentUsdc: '1',
  sendUsdc: '0.20',
  smallPaymentUsdc: '0.25',
  smallSweepUsdc: '0.05',
  recipient,
});
const weeklyUsdc = parseUnits('1', 6);
const sweep = await activate(sweepProgram, 'Income sweep smoke', weeklyUsdc);

const runs = [];
for (const [amount, path, status] of [
  ['1.20', 1, 1],
  ['0.60', 3, 1],
  ['0.10', 4, 2],
] as const) {
  const origin = await send(
    uni,
    uni.config.usdc,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [vault, parseUnits(amount, 6)],
    }),
  );
  const run = await proof(
    'Payment ' + amount + ' USDC',
    sweep,
    path,
    status,
    origin.transactionHash,
  );
  runs.push({ ...run, inputUsdcBaseUnits: parseUnits(amount, 6).toString() });
}

// A scheduled buy proves the Cron100 limb on the same pair; the Vault swaps and pays the fee.
const scheduleProgram = createWorkflowV2Recipe('scheduled-buy', {
  buyUsdc: '0.2',
  slippagePercent: '0.5',
  intervalSeconds: '3600',
});
const schedule = await activate(scheduleProgram, 'Scheduled buy smoke', parseUnits('1', 6));
const scheduledRun = await proof('Scheduled buy', schedule, 0, 1);

const evidence = {
  agentFactory,
  vaultFactory,
  deploymentCommit: records[0]?.commit.slice(0, 7),
  agent,
  vault,
  recipient,
  sweep: {
    title: sweep.title,
    workflow: sweep.id,
    programHash: sweep.hash,
    weeklyUsdcLimitBaseUnits: weeklyUsdc.toString(),
    authorizationTransaction: sweep.authorized.transactionHash,
    runs,
  },
  schedule: {
    title: schedule.title,
    workflow: schedule.id,
    programHash: schedule.hash,
    authorizationTransaction: schedule.authorized.transactionHash,
    run: scheduledRun,
  },
};
await writeFile(
  new URL('../deployments/workflows-v2-smoke.json', import.meta.url),
  JSON.stringify(evidence, null, 2) + '\n',
);
process.stdout.write('Wrote deployments/workflows-v2-smoke.json\n');
