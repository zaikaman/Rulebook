import { parseUnits } from 'viem';

import { deadline, demoPool, reportFailure, routerAbi } from './seed-thin-pair.js';

async function move() {
  const pool = await demoPool();
  if (!pool.reserves?.[0] || !pool.reserves[1])
    throw new Error('Seed the demo pair before swapping.');
  const sell = process.env.DEMO_SELL_TOKEN;
  if (sell !== 'USDC' && sell !== 'WETH') throw new Error('Set DEMO_SELL_TOKEN to USDC or WETH.');
  const amount = parseUnits(process.env.DEMO_SWAP_AMOUNT ?? '', sell === 'USDC' ? 6 : 18);
  if (amount <= 0n) throw new Error('Set a positive DEMO_SWAP_AMOUNT.');
  const path =
    sell === 'USDC' ? [pool.chain.usdc, pool.chain.weth] : [pool.chain.weth, pool.chain.usdc];
  const [, quote] = await pool.publicClient.readContract({
    address: pool.router,
    abi: routerAbi,
    functionName: 'getAmountsOut',
    args: [amount, path],
  });
  if (!quote) throw new Error('The router returned an empty quote.');
  const minOut = (quote * 99n) / 100n;
  if (minOut === 0n) throw new Error('The quoted output is too small.');
  process.stdout.write(
    `Demo pair ${pool.pair}, sell ${amount} ${sell} base units, minOut ${minOut}.\n`,
  );
  if (process.env.DEMO_BROADCAST !== '1') return;

  const wallet = pool.signer();
  await pool.approve(sell === 'USDC' ? pool.chain.usdc : pool.chain.weth, amount, wallet);
  const { request } = await pool.publicClient.simulateContract({
    account: wallet.account,
    address: pool.router,
    abi: routerAbi,
    functionName: 'swapExactTokensForTokens',
    args: [amount, minOut, path, wallet.account.address, deadline()],
  });
  await pool.confirm(await wallet.writeContract(request));
}

move().catch(reportFailure);
