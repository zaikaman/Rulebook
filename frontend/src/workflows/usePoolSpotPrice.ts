import { isFundsChain, type FundsChainId } from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';

import { readPoolSpotPrice } from './chainV2';

export function usePoolSpotPrice(chain: FundsChainId | undefined, enabled = true) {
  return useQuery({
    queryKey: ['workflow-v2', 'pool-spot-price', chain],
    enabled: Boolean(enabled && chain && isFundsChain(chain)),
    queryFn: () => readPoolSpotPrice(chain!),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}
