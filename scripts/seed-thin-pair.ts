import { getChain, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  zeroAddress,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { unichainSepolia } from 'viem/chains';
import { pathToFileURL } from 'node:url';

const chain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
const factoryAbi = parseAbi(['function getPair(address, address) view returns (address)']);
const pairAbi = parseAbi(['function getReserves() view returns (uint112, uint112, uint32)']);
export const routerAbi = parseAbi([
  'function factory() view returns (address)',
  'function addLiquidity(address, address, uint256, uint256, uint256, uint256, address, uint256) returns (uint256, uint256, uint256)',
  'function getAmountsOut(uint256, address[]) view returns (uint256[])',
  'function swapExactTokensForTokens(uint256, uint256, address[], address, uint256) returns (uint256[])',
]);

export async function demoPool() {
  const router = getAddress(process.env.DEMO_ROUTER_ADDRESS ?? '');
  if (router === chain.router) throw new Error('Use the separate demo router.');
  const transport = http(process.env.UNICHAIN_RPC_URL ?? chain.rpcUrl);
  const publicClient = createPublicClient({ chain: unichainSepolia, transport });
  if ((await publicClient.getChainId()) !== chain.chainId) {
    throw new Error('The demo scripts only run on Unichain Sepolia.');
  }
  const factory = await publicClient.readContract({
    address: router,
    abi: routerAbi,
    functionName: 'factory',
  });
  async function readPair() {
    const pair = await publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: 'getPair',
      args: [chain.usdc, chain.weth],
    });
    if (pair.toLowerCase() === chain.pair.toLowerCase()) {
      throw new Error('The demo router resolves to the public WETH/USDC pool.');
    }
    return pair;
  }
  const pair = await readPair();
  const reserves =
    pair === zeroAddress
      ? null
      : await publicClient.readContract({
          address: pair,
          abi: pairAbi,
          functionName: 'getReserves',
        });

  function signer() {
    const key = process.env.DEMO_WALLET_PRIVATE_KEY;
    if (!key || !/^0x[a-f0-9]{64}$/i.test(key)) throw new Error('Set DEMO_WALLET_PRIVATE_KEY.');
    return createWalletClient({
      account: privateKeyToAccount(key as `0x${string}`),
      chain: unichainSepolia,
      transport,
    });
  }

  async function confirm(hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
    process.stdout.write(`${receipt.transactionHash}\n`);
  }

  async function approve(token: Address, amount: bigint, wallet: ReturnType<typeof signer>) {
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [wallet.account.address, router],
    });
    if (allowance >= amount) return;
    await confirm(
      await wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [router, amount],
      }),
    );
  }

  return { router, pair, chain, reserves, readPair, publicClient, signer, approve, confirm };
}

async function seed() {
  const pool = await demoPool();
  if (pool.reserves && (pool.reserves[0] !== 0n || pool.reserves[1] !== 0n)) {
    throw new Error('The demo pair already has liquidity.');
  }
  const usdc = parseUnits(process.env.DEMO_SEED_USDC ?? '30', 6);
  const weth = parseUnits(process.env.DEMO_SEED_WETH ?? '0.02', 18);
  if (usdc <= 0n || weth <= 0n) throw new Error('Seed amounts must be positive.');
  process.stdout.write(
    `Demo router ${pool.router}, seed ${usdc} USDC base units and ${weth} WETH wei.\n`,
  );
  if (process.env.DEMO_BROADCAST !== '1') return;

  const wallet = pool.signer();
  await pool.approve(pool.chain.usdc, usdc, wallet);
  await pool.approve(pool.chain.weth, weth, wallet);
  const { request } = await pool.publicClient.simulateContract({
    account: wallet.account,
    address: pool.router,
    abi: routerAbi,
    functionName: 'addLiquidity',
    args: [
      pool.chain.usdc,
      pool.chain.weth,
      usdc,
      weth,
      usdc,
      weth,
      wallet.account.address,
      deadline(),
    ],
  });
  await pool.confirm(await wallet.writeContract(request));
  process.stdout.write(`Demo pair: ${await pool.readPair()}\n`);
}

export function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 300);
}

export function reportFailure(error: unknown) {
  const message =
    error instanceof Error && 'shortMessage' in error
      ? String(error.shortMessage)
      : error instanceof Error
        ? error.message
        : 'Demo transaction failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed().catch(reportFailure);
}
