import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  encodeWorkflow,
  executionCreditAbi,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentAbi,
  workflowDirectoryAbi,
  workflowVaultAbi,
  workflowVaultFactoryAbi,
  type WorkflowDraft,
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
  parseAbi,
  parseEther,
  parseUnits,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('Set ' + name + ' before running the testnet canaries.');
  return value;
}

function address(name: string): Address {
  const value = env(name);
  if (!isAddress(value)) throw new Error('Invalid address in ' + name);
  return value;
}

function connection(id: number, rpc: string, symbol: string) {
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
const directory = address('WORKFLOW_DIRECTORY_ADDRESS');
const factory = address('WORKFLOW_VAULT_FACTORY_ADDRESS');
const key = env('DEPLOYER_PRIVATE_KEY');
const primary = privateKeyToAccount((key.startsWith('0x') ? key : '0x' + key) as Hex);
const cache = resolve('contracts/cache');
const secondKeyPath = resolve(cache, 'workflow-copy.private');
let secondaryKey: Hex;
try {
  secondaryKey = (await readFile(secondKeyPath, 'utf8')).trim() as Hex;
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
    throw error;
  secondaryKey = generatePrivateKey();
  await writeFile(secondKeyPath, secondaryKey, { flag: 'wx', mode: 0o600 });
}
const secondary = privateKeyToAccount(secondaryKey);
const ownerId = env('WORKFLOW_CANARY_ID');
const observations: Record<string, string | object> = {};

function report(name: string, record: string | object) {
  observations[name] = record;
  process.stdout.write(name + ' ' + JSON.stringify(record) + '\n');
  return writeFile(
    resolve(cache, 'workflow-canary-' + ownerId.replace(/[^0-9a-z-]/gi, '') + '.json'),
    JSON.stringify(observations, null, 2) + '\n',
  );
}

async function send(
  network: typeof lasna,
  account: typeof primary,
  to: Address,
  data?: Hex,
  value = 0n,
) {
  const wallet = createWalletClient({
    chain: network.chain,
    transport: network.transport,
    account,
  });
  const fees =
    network.chain.id === LASNA_CHAIN_ID
      ? {
          maxPriorityFeePerGas: 1n,
          maxFeePerGas: (await network.public.getGasPrice()) * 2n + 1n,
        }
      : {};
  const hash = await wallet
    .sendTransaction({ to, data, value, ...fees })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message.split('\n')[0] : 'Transaction rejected';
      throw new Error(network.chain.name + ': ' + message);
    });
  const receipt = await network.public.waitForTransactionReceipt({
    hash,
    confirmations: 2,
    timeout: 90_000,
  });
  if (receipt.status !== 'success') throw new Error('Testnet transaction reverted ' + hash);
  return receipt;
}

async function setup(account: typeof primary, watch: bigint, execution: bigint) {
  let agent = await lasna.public.readContract({
    address: directory,
    abi: workflowDirectoryAbi,
    functionName: 'agentOf',
    args: [account.address],
  });
  if (agent === zeroAddress) {
    await send(
      lasna,
      account,
      directory,
      encodeFunctionData({ abi: workflowDirectoryAbi, functionName: 'create' }),
    );
    agent = await lasna.public.readContract({
      address: directory,
      abi: workflowDirectoryAbi,
      functionName: 'agentOf',
      args: [account.address],
    });
  }
  let vault = await uni.public.readContract({
    address: factory,
    abi: workflowVaultFactoryAbi,
    functionName: 'vaultOf',
    args: [account.address],
  });
  if (vault === zeroAddress) {
    await send(
      uni,
      account,
      factory,
      encodeFunctionData({ abi: workflowVaultFactoryAbi, functionName: 'create', args: [agent] }),
    );
    vault = await uni.public.readContract({
      address: factory,
      abi: workflowVaultFactoryAbi,
      functionName: 'vaultOf',
      args: [account.address],
    });
  }
  const linked = await lasna.public.readContract({
    address: agent,
    abi: workflowAgentAbi,
    functionName: 'vault',
  });
  if (linked === zeroAddress) {
    await send(
      lasna,
      account,
      agent,
      encodeFunctionData({ abi: workflowAgentAbi, functionName: 'linkVault', args: [vault] }),
    );
  } else if (linked.toLowerCase() !== vault.toLowerCase())
    throw new Error('Unexpected linked Vault.');
  for (const [network, service, target, amount] of [
    [lasna, lasna.config.systemContract, agent, watch],
    [uni, uni.config.callbackProxy, vault, execution],
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
        account,
        service,
        encodeFunctionData({ abi: executionCreditAbi, functionName: 'depositTo', args: [target] }),
        amount - reserve,
      );
    }
  }
  return { agent, vault, account };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function activate(setup: Setup, preset: WorkflowDraft, name: string, listing = 0n) {
  const { agent, vault, account } = setup;
  const id = keccak256(stringToHex(ownerId + '-' + name));
  const program = encodeWorkflow(preset, vault);
  const hash = keccak256(program);
  const existing = await lasna.public.readContract({
    address: agent,
    abi: workflowAgentAbi,
    functionName: 'workflows',
    args: [id],
  });
  if (existing[5] && existing[0] === hash) return id;
  const staged = await uni.public.readContract({
    address: vault,
    abi: workflowVaultAbi,
    functionName: 'authorizations',
    args: [id],
  });
  const epoch =
    staged[3] && staged[0] === hash && staged[1] > existing[1]
      ? staged[1]
      : (staged[1] > existing[1] ? staged[1] : existing[1]) + 1n;
  if (epoch !== staged[1])
    await send(
      uni,
      account,
      vault,
      encodeFunctionData({
        abi: workflowVaultAbi,
        functionName: 'authorize',
        args: [id, epoch, program],
      }),
    );
  const [, confirmedEpoch, start] = await uni.public.readContract({
    address: vault,
    abi: workflowVaultAbi,
    functionName: 'authorizations',
    args: [id],
  });
  const receipt = await send(
    lasna,
    account,
    agent,
    encodeFunctionData({
      abi: workflowAgentAbi,
      functionName: 'enable',
      args: [id, confirmedEpoch, start, program, existing[1] === 0n ? listing : 0n, preset.title],
    }),
  );
  await report(name + ' activation', { id, agent, vault, transaction: receipt.transactionHash });
  return id;
}

const alert = { kind: 'alert', amount: '', unit: 'fixed', recipient: '' } as const;
function savings(recipient: Address): WorkflowDraft {
  return {
    title: 'Save from every payment',
    trigger: 'payment',
    price: '',
    intervalHours: '24',
    rising: false,
    spendLimit: '1',
    slippage: '0.5',
    nodes: [
      { type: 'condition', amount: '1', yes: 1, no: 2 },
      {
        type: 'path',
        actions: [{ kind: 'send', amount: '20', unit: 'percent', recipient }, alert],
      },
      { type: 'condition', amount: '0.25', yes: 3, no: 4 },
      { type: 'path', actions: [{ kind: 'send', amount: '5', unit: 'percent', recipient }, alert] },
      { type: 'path', actions: [] },
    ],
  };
}

const decision = getAbiItem({ abi: workflowAgentAbi, name: 'WorkflowDecided' });
const outcome = getAbiItem({ abi: workflowVaultAbi, name: 'WorkflowOutcome' });
const steps = getAbiItem({ abi: workflowVaultAbi, name: 'WorkflowStep' });
const quoteAbi = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 timestamp)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[])',
]);

async function proof(
  chainWindow: { lasna: bigint; uni: bigint },
  account: Setup,
  workflowId: Hex,
  label: string,
  expectLeaf: number,
  origin?: Hex,
  expectSent?: bigint,
) {
  const until = Date.now() + 270_000;
  while (Date.now() < until) {
    const decisions = await lasna.public.getLogs({
      address: account.agent,
      event: decision,
      args: { workflowId },
      fromBlock: chainWindow.lasna,
      toBlock: 'latest',
      strict: true,
    });
    const match = decisions.find((event) => !origin || event.args.originTransaction === origin);
    if (match) {
      if (match.args.leaf !== expectLeaf) throw new Error(label + ' chose the wrong branch.');
      if (match.args.skipped) {
        await report(label, {
          origin: match.args.originTransaction,
          decision: match.transactionHash,
          runId: match.args.runId,
          status: 'Skipped',
        });
        return;
      }
      const results = await uni.public.getLogs({
        address: account.vault,
        event: outcome,
        args: { runId: match.args.runId },
        fromBlock: chainWindow.uni,
        toBlock: 'latest',
        strict: true,
      });
      const result = results[0];
      if (result) {
        if (!result.args.completed)
          throw new Error(label + ' did not settle: ' + result.args.reason);
        const actionLogs = await uni.public.getLogs({
          address: account.vault,
          event: steps,
          args: { runId: match.args.runId },
          fromBlock: result.blockNumber,
          toBlock: result.blockNumber,
          strict: true,
        });
        if (
          expectSent !== undefined &&
          (actionLogs[0]?.args.amount !== expectSent || actionLogs[1]?.args.kind !== 3)
        ) {
          throw new Error(label + ' wrong settled steps.');
        }
        await report(label, {
          origin: match.args.originTransaction,
          decision: match.transactionHash,
          destination: result.transactionHash,
          runId: match.args.runId,
          status: 'Completed',
        });
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(label + ' did not complete within the live observation window.');
}

async function payment(vault: Address, amount: string) {
  return send(
    uni,
    primary,
    uni.config.usdc,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [vault, parseUnits(amount, 6)],
    }),
  );
}

async function crossing(account: Setup, window: { lasna: bigint; uni: bigint }) {
  const pair = uni.config.pair;
  const router = uni.config.router;
  const [a, b] = await uni.public.readContract({
    address: pair,
    abi: quoteAbi,
    functionName: 'getReserves',
  });
  const usdcIsFirst = uni.config.usdc.toLowerCase() < uni.config.weth.toLowerCase();
  let [u, w] = usdcIsFirst ? [a, b] : [b, a];
  const input = parseUnits('0.10', 6);
  const price = () => (u * 10n ** 30n) / w;
  const projectSwap = () => {
    const quote = (input * 997n * w) / (u * 1000n + input * 997n);
    u += input;
    w -= quote;
    return quote;
  };
  const firstQuote = projectSwap();
  const baseline = price();
  const secondQuote = projectSwap();
  const limit = (baseline + price()) / 2n;
  const target =
    (limit / 10n ** 18n).toString() + '.' + (limit % 10n ** 18n).toString().padStart(18, '0');
  const id = await activate(
    account,
    {
      ...savings(primary.address),
      title: 'Watch a rising WETH price',
      trigger: 'price',
      price: target,
      rising: true,
      spendLimit: '0',
      nodes: [{ type: 'path', actions: [alert] }],
    },
    'price',
  );
  await send(
    uni,
    primary,
    uni.config.usdc,
    encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [router, input * 2n] }),
  );
  const swap = (quote: bigint) =>
    send(
      uni,
      primary,
      router,
      encodeFunctionData({
        abi: quoteAbi,
        functionName: 'swapExactTokensForTokens',
        args: [
          input,
          (quote * 99n) / 100n,
          [uni.config.usdc, uni.config.weth],
          primary.address,
          BigInt(Math.floor(Date.now() / 1000) + 300),
        ],
      }),
    );
  await swap(firstQuote);
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const rise = await swap(secondQuote);
  return proof(window, account, id, 'Price crossing', 0, rise.transactionHash);
}

if (
  (await lasna.public.getChainId()) !== LASNA_CHAIN_ID ||
  (await uni.public.getChainId()) !== UNICHAIN_SEPOLIA_CHAIN_ID
) {
  throw new Error('The Workflow canary runs on Lasna and Unichain Sepolia testnets only.');
}
if (
  !(await lasna.public.getCode({ address: directory })) ||
  !(await uni.public.getCode({ address: factory }))
) {
  throw new Error('The configured Workflow factories have not been deployed.');
}

const wallets = await setup(primary, parseEther('0.40'), parseEther('0.00035'));
const window = {
  lasna: await lasna.public.getBlockNumber(),
  uni: await uni.public.getBlockNumber(),
};
const payments = await activate(wallets, savings(secondary.address), 'payments');
const deployedHash = keccak256(encodeWorkflow(savings(secondary.address), wallets.vault));
let listing = await lasna.public.readContract({
  address: directory,
  abi: workflowDirectoryAbi,
  functionName: 'listingOf',
  args: [wallets.agent, payments, deployedHash],
});
if (listing === 0n) {
  const published = await send(
    lasna,
    primary,
    directory,
    encodeFunctionData({
      abi: workflowDirectoryAbi,
      functionName: 'publish',
      args: [
        payments,
        'Save from every payment',
        'Put 20% of larger USDC payments and 5% of smaller payments into a savings wallet. Record each transfer on-chain.',
      ],
    }),
  );
  listing = await lasna.public.readContract({
    address: directory,
    abi: workflowDirectoryAbi,
    functionName: 'listingOf',
    args: [wallets.agent, payments, deployedHash],
  });
  await report('Marketplace publication', {
    listing: listing.toString(),
    transaction: published.transactionHash,
    workflowId: payments,
  });
}

const proofs: Promise<void>[] = [];
for (const [amount, leaf, saved] of [
  ['1.20', 1, 240000n],
  ['0.60', 3, 30000n],
  ['0.10', 4, undefined],
] as const) {
  const origin = await payment(wallets.vault, amount);
  proofs.push(
    proof(
      window,
      wallets,
      payments,
      'Payment ' + amount + ' USDC',
      leaf,
      origin.transactionHash,
      saved,
    ),
  );
}
const schedule = await activate(
  wallets,
  {
    ...savings(primary.address),
    title: 'Daily check-in',
    trigger: 'schedule',
    intervalHours: '1',
    spendLimit: '0',
    nodes: [{ type: 'path', actions: [alert] }],
  },
  'schedule',
);
proofs.push(proof(window, wallets, schedule, 'Native scheduled tick', 0));
proofs.push(crossing(wallets, window));

const copy = async () => {
  if ((await lasna.public.getBalance({ address: secondary.address })) < parseEther('0.18'))
    await send(lasna, primary, secondary.address, undefined, parseEther('0.35'));
  if ((await uni.public.getBalance({ address: secondary.address })) < parseEther('0.00018'))
    await send(uni, primary, secondary.address, undefined, parseEther('0.00035'));
  const copyWallets = await setup(secondary, parseEther('0.10'), parseEther('0.00010'));
  const copyDefinition = { ...savings(primary.address), title: 'My savings copy' };
  const id = await activate(copyWallets, copyDefinition, 'copy', listing);
  const origin = await payment(copyWallets.vault, '1.10');
  await proof(window, copyWallets, id, 'Copy wallet payment', 1, origin.transactionHash, 220000n);
};

// Price and payments use the same account. Wait for its pending writes before funding the second owner.
const firstResults = await Promise.allSettled(proofs);
const copyResult = await Promise.allSettled([copy()]);
for (const result of [...firstResults, ...copyResult])
  if (result.status === 'rejected') console.error(result.reason);
if ([...firstResults, ...copyResult].some((result) => result.status === 'rejected'))
  process.exitCode = 1;
