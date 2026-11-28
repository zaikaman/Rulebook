import { readFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';

import {
  BASE_SEPOLIA_CHAIN_ID as BASE,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID as UNI,
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  getChain,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowVaultV2Abi,
} from '@rulebook/shared';
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  maxUint64,
  parseEventLogs,
  toHex,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

function launchCatalog(owner) {
  const day = 86_400;
  const week = String(7 * day);
  return [
    {
      recipe: 'trailing-stop',
      title: 'WETH trailing stop',
      description:
        'Sell a fixed amount of WETH after a fall from its high or if it hits a fixed stop price. The workflow closes after one sale.',
      chain: UNI,
      inputs: { stopPrice: '1600', trailPercent: '8', sellWeth: '0.001', slippagePercent: '2' },
    },
    {
      recipe: 'price-band',
      title: 'WETH range rebalancer',
      description:
        'Sell a little WETH above your price band and buy below it. Inside the band, the vault makes no trade.',
      chain: BASE,
      inputs: {
        referencePrice: '2000',
        bandPercent: '10',
        buyUsdc: '1',
        sellWeth: '0.001',
        slippagePercent: '2',
      },
    },
    {
      recipe: 'buy-the-dip',
      title: 'Buy WETH after a dip',
      description:
        'Check the pool price hourly and buy WETH with a fixed USDC amount only when the observed price falls by your chosen percentage.',
      chain: UNI,
      inputs: {
        intervalSeconds: '3600',
        dipPercent: '3',
        buyUsdc: '1',
        slippagePercent: '2',
      },
    },
    {
      recipe: 'price-alert',
      title: 'WETH target alert',
      description:
        'Record an alert once WETH reaches your target pool price. Connect Telegram to receive a notification away from the app.',
      chain: UNI,
      inputs: { targetPrice: '2400', direction: 'rising' },
    },
    {
      recipe: 'large-transfer-alert',
      title: 'Large USDC transfer alert',
      description:
        'Flag the first USDC transfer above your threshold into or out of a wallet. Set the wallet address you want to monitor after copying.',
      chain: BASE,
      inputs: {
        token: getChain(BASE).usdc,
        watchedWallet: owner,
        minimumTransferRaw: '10000000',
      },
    },
    {
      recipe: 'recurring-transfer',
      title: 'Weekly USDC savings transfer',
      description:
        'Send a fixed amount of USDC from your vault to a savings wallet once a week. Choose your own destination after copying.',
      chain: UNI,
      inputs: { intervalSeconds: week, sendUsdc: '2', recipient: owner },
    },
    {
      recipe: 'scheduled-buy',
      title: 'Weekly WETH accumulation',
      description:
        'Swap a fixed USDC amount for WETH once a week. Set the order size and slippage limit before activating.',
      chain: BASE,
      inputs: { intervalSeconds: week, buyUsdc: '1', slippagePercent: '2' },
    },
    {
      recipe: 'balance-refill',
      title: 'Vault reserve top-up',
      description:
        'Check your vault daily and refill it from your wallet when USDC falls below your floor. The top-up is limited by your allowance and cap.',
      chain: BASE,
      inputs: { intervalSeconds: String(day), floorUsdc: '5', refillUsdc: '2' },
    },
    {
      recipe: 'price-range-alert',
      title: 'Cross-chain WETH range alert',
      description:
        'Watch the WETH pool on Unichain Sepolia and record an alert on Base Sepolia if the price moves outside your range. No swap is placed.',
      chain: BASE,
      originChain: UNI,
      inputs: { lowerPrice: '1800', upperPrice: '2400' },
    },
    {
      recipe: 'income-sweep',
      title: 'Set aside part of each USDC payment',
      description:
        'Send a fixed portion of eligible vault payments to your savings wallet. Use two payment thresholds to set aside less from smaller deposits.',
      chain: UNI,
      inputs: {
        minimumPaymentUsdc: '1',
        sendUsdc: '0.20',
        smallPaymentUsdc: '0.25',
        smallSweepUsdc: '0.05',
        recipient: owner,
      },
    },
  ];
}

const lasna = getChain(LASNA_CHAIN_ID);

async function main() {
  const { values } = parseArgs({ options: { publish: { type: 'boolean' } } });
  const localEnv = await readFile(new URL('../contracts/.env', import.meta.url), 'utf8').catch(
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    },
  );
  const env = { ...parseEnv(localEnv), ...process.env };
  const key = env.DEPLOYER_PRIVATE_KEY?.trim().replace(/^0x/i, '');
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('Set DEPLOYER_PRIVATE_KEY for Lasna.');
  const account = privateKeyToAccount(`0x${key}`);
  const records = JSON.parse(
    await readFile(new URL('../deployments/workflows-v2.json', import.meta.url), 'utf8'),
  );
  const factoryRecord = records.find(
    (record) => record.chainId === LASNA_CHAIN_ID && record.contract === 'WorkflowAgentFactoryV2',
  );
  if (!factoryRecord) throw new Error('The Lasna factory is missing from the deployment record.');
  const factory = { address: getAddress(factoryRecord.address), abi: workflowAgentFactoryV2Abi };
  const transport = http(env.LASNA_RPC_URL || lasna.rpcUrl);
  const publicClient = createPublicClient({ transport });
  if ((await publicClient.getChainId()) !== LASNA_CHAIN_ID) throw new Error('Expected Lasna RPC.');
  const bytecode = await publicClient.getCode({ address: factory.address });
  if (!bytecode || keccak256(bytecode) !== factoryRecord.runtimeCodeHash)
    throw new Error('The Lasna factory bytecode differs from the deployment record.');
  const agentAddress = await publicClient.readContract({
    ...factory,
    functionName: 'agentOf',
    args: [account.address],
  });
  if (agentAddress === zeroAddress)
    throw new Error('Create and link the testnet publishing agent.');
  const agent = { address: agentAddress, abi: workflowAgentV2Abi };
  const wallet = createWalletClient({
    account,
    chain: {
      id: LASNA_CHAIN_ID,
      name: lasna.name,
      nativeCurrency: { name: 'Lasna REACT', symbol: 'lREACT', decimals: 18 },
      rpcUrls: { default: { http: [lasna.rpcUrl] } },
    },
    transport,
  });

  // Prove the linked testnet vaults exist before evaluating any write.
  const vaults = new Map();
  for (const chainId of [UNI, BASE]) {
    const client = createPublicClient({
      transport: http(
        (chainId === UNI ? env.UNICHAIN_RPC_URL : env.BASE_SEPOLIA_RPC_URL) ||
          getChain(chainId).rpcUrl,
      ),
    });
    const address = await publicClient.readContract({
      ...agent,
      functionName: 'vaults',
      args: [chainId],
    });
    if (address === zeroAddress || (await client.getChainId()) !== chainId)
      throw new Error(`Link a vault on ${getChain(chainId).name} first.`);
    const owner = await client.readContract({
      address,
      abi: workflowVaultV2Abi,
      functionName: 'owner',
    });
    if (!isAddressEqual(owner, account.address))
      throw new Error(`The linked vault on ${getChain(chainId).name} has a different owner.`);
    vaults.set(chainId, { client, address });
  }

  const plans = await Promise.all(
    launchCatalog(account.address).map(async (seed) => {
      const program = createWorkflowV2Recipe(seed.recipe, seed.inputs, {
        chain: seed.chain,
        originChain: seed.originChain,
        vault: vaults.get(seed.chain).address,
      });
      const encoded = encodeWorkflowV2(program);
      const hash = keccak256(encoded);
      const id = keccak256(toHex(`rulebook:marketplace:launch:v1:${seed.recipe}`));
      const vault = vaults.get(seed.chain);
      const [entry, auth, listing] = await Promise.all([
        publicClient.readContract({ ...agent, functionName: 'entries', args: [id] }),
        vault.client.readContract({
          address: vault.address,
          abi: workflowVaultV2Abi,
          functionName: 'authorizations',
          args: [id],
        }),
        publicClient.readContract({
          ...factory,
          functionName: 'listingOf',
          args: [agent.address, id, hash],
        }),
      ]);
      if (auth[3] || (entry[1] && entry[0] !== hash))
        throw new Error(`Unexpected workflow state for ${seed.recipe}.`);
      const visible =
        listing !== 0n &&
        (
          await publicClient.readContract({
            ...factory,
            functionName: 'listings',
            args: [listing],
          })
        )[4];
      return { seed, encoded, hash, id, entry, listing, visible };
    }),
  );

  async function send(label, call) {
    const gasPrice = (await publicClient.getGasPrice()) + 1n;
    const { request } = await publicClient.simulateContract({ ...call, account });
    const hash = await wallet.writeContract({ ...request, gasPrice });
    console.log(`${label}: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 2,
      timeout: 90_000,
    });
    if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
    return receipt;
  }

  console.log(
    `Publishing wallet ${account.address}, balance ${formatEther(await publicClient.getBalance({ address: account.address }))} lREACT`,
  );
  for (const { seed, encoded, hash, id, entry, listing, visible } of plans) {
    const [, epoch, , , trigger] = entry;
    // A future origin floor suppresses same-chain event triggers during registration.
    // No seed receives destination authorization while its subscription is being installed.
    const enable = {
      ...agent,
      functionName: 'enable',
      args: [id, epoch + 1n, encoded, seed.title, maxUint64],
    };
    if (!values.publish) {
      const gas =
        epoch === 0n ? await publicClient.estimateContractGas({ ...enable, account }) : 0n;
      console.log(`${seed.title} | listing ${listing || 'new'} | enable estimate ${gas} gas`);
      continue;
    }
    const registration = epoch === 0n ? await send(`Register ${seed.title}`, enable) : null;
    if (epoch === 0n || trigger !== 0) {
      const current = await publicClient.readContract({
        ...agent,
        functionName: 'entries',
        args: [id],
        blockNumber: registration?.blockNumber,
      });
      if (current[0] !== hash)
        throw new Error(`Program changed during registration for ${seed.recipe}.`);
      if (current[4] !== 0) {
        await send(`Disable ${seed.title}`, {
          ...agent,
          functionName: 'disable',
          args: [id, current[1]],
        });
      }
    }
    if (visible) continue;
    if (listing !== 0n) {
      console.log(`Skipping previously unpublished listing ${listing}: ${seed.title}`);
      continue;
    }
    const receipt = await send(`Publish ${seed.title}`, {
      ...factory,
      functionName: 'publish',
      args: [id, seed.description],
    });
    const [event] = parseEventLogs({
      abi: factory.abi,
      eventName: 'Published',
      logs: receipt.logs.filter((log) => isAddressEqual(log.address, factory.address)),
    });
    if (!event || event.args.workflow !== id || event.args.programHash !== hash)
      throw new Error(`Missing publication proof for ${seed.recipe}.`);
    console.log(`Listing ${event.args.listing}: ${seed.title}`);
  }
}

main().catch((error) => {
  console.error(error.shortMessage ?? error.message);
  process.exitCode = 1;
});
