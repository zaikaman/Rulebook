import { agentAbi, type Address, type Rule } from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError } from 'viem';

import { RULE_FLAGS } from '../lib/rules.js';
import { lasnaPublicClient } from '../lib/wagmi.js';

export const evaluationOrderKey = (agent: Address | null) => [
  'evaluation-order',
  agent?.toLowerCase(),
];

export async function readEvaluationOrder(agent: Address, indexedRules: readonly Rule[] = []) {
  const blockNumber = await lasnaPublicClient.getBlockNumber({ cacheTime: 0 });
  const contract = { address: agent, abi: agentAbi, blockNumber } as const;
  const live = await lasnaPublicClient
    .readContract({ ...contract, functionName: 'getEvaluationOrder' })
    .catch((error: unknown) => {
      if (
        error instanceof BaseError &&
        error.walk(
          (cause) =>
            cause instanceof ContractFunctionRevertedError ||
            cause instanceof ContractFunctionZeroDataError,
        )
      )
        return null;
      throw error;
    });
  const legacy =
    live === null
      ? await lasnaPublicClient.readContract({ ...contract, functionName: 'getRuleIds' })
      : null;
  const archived = new Set(
    indexedRules.filter((rule) => rule.status === 'cancelled').map((rule) => rule.rule_id),
  );
  const known = indexedRules
    .filter((rule) => rule.status !== 'cancelled')
    .map((rule) => rule.rule_id);
  const ids = [...new Set([...(legacy ?? live ?? []), ...known])].filter((id) => !archived.has(id));
  const flags = new Map<bigint, number>();
  for (let index = 0; index < ids.length; index += 12) {
    await Promise.all(
      ids.slice(index, index + 12).map(async (id) => {
        const rule = await lasnaPublicClient.readContract({
          ...contract,
          functionName: 'getRule',
          args: [id],
        });
        if (rule.template !== 0) flags.set(id, rule.flags);
      }),
    );
  }
  return {
    ids: live ?? legacy?.filter((id) => ((flags.get(id) ?? 0) & RULE_FLAGS.active) !== 0) ?? [],
    legacy,
    flags,
  };
}

export type EvaluationOrder = Awaited<ReturnType<typeof readEvaluationOrder>>;

export function useEvaluationOrder(agent: Address | null, indexedRules: readonly Rule[] = []) {
  const indexedState = indexedRules.map((rule) => `${rule.rule_id}:${rule.status}`).join(',');
  return useQuery({
    queryKey: [...evaluationOrderKey(agent), indexedState],
    queryFn: () => readEvaluationOrder(agent as Address, indexedRules),
    enabled: Boolean(agent),
    refetchInterval: 30_000,
  });
}
