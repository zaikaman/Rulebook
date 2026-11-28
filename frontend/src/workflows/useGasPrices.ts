import {
  estimateRunCostWei,
  getChain,
  isAutomationChain,
  workflowVaultFactoryV2Abi,
  type AutomationChainId,
  type FundsChainId,
  type NetworkMode,
} from '@rulebook/shared';
import { useQueries } from '@tanstack/react-query';
import { formatGwei, parseAbi } from 'viem';

import { settlementFactory, workflowClient } from './chainV2';

const feePricingAbi = parseAbi([
  'function _extraGas() view returns (uint256)',
  'function _gasPriceCoeffPer1000() view returns (uint256)',
]);

async function readRunCost(chain: AutomationChainId | FundsChainId, gasPriceWei: bigint) {
  const client = workflowClient(chain);
  const watching = isAutomationChain(chain);
  const factory = watching ? undefined : settlementFactory(chain);
  const address = watching
    ? getChain(chain).systemContract
    : factory
      ? await client.readContract({
          address: factory,
          abi: workflowVaultFactoryV2Abi,
          functionName: 'callbackProxy',
        })
      : getChain(chain).callbackProxy;
  const [extraGas, coefficient] = await Promise.all([
    client.readContract({ address, abi: feePricingAbi, functionName: '_extraGas' }),
    client.readContract({ address, abi: feePricingAbi, functionName: '_gasPriceCoeffPer1000' }),
  ]);
  return estimateRunCostWei(
    watching ? 'watching' : 'execution',
    gasPriceWei,
    extraGas,
    coefficient,
  );
}

/** Fetches and caches live gas prices for each requested chain; React Query dedupes across views. */
export function useChainGasPrices(
  chains: readonly (AutomationChainId | FundsChainId)[],
  mode: NetworkMode,
) {
  return useQueries({
    queries: chains.map((chain) => ({
      queryKey: ['workflow-v2', 'gas-price', mode, chain],
      queryFn: async () => {
        const gasPriceWei = await workflowClient(chain).getGasPrice();
        const runCostWei = await readRunCost(chain, gasPriceWei).catch(() => null);
        return { gasPriceWei, runCostWei };
      },
      staleTime: 30_000,
      refetchInterval: 60_000,
      retry: 1,
    })),
  });
}

/** Formats a wei gas price into readable gwei without trailing zero noise. */
export function formatDisplayGasPrice(gasPriceWei: bigint): string {
  if (gasPriceWei <= 0n) return '0';
  if (gasPriceWei < 100_000n) return '< 0.0001';
  const raw = formatGwei(gasPriceWei);
  const [whole = '0', fraction] = raw.split('.');
  if (!fraction) return whole;
  const maxDecimals = Number(whole) >= 10 ? 2 : 4;
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
