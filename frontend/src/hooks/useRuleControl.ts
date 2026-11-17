import { agentAbi, LASNA_CHAIN_ID, type Address } from '@rulebook/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi';

import { lasnaPublicClient } from '../lib/wagmi.js';

type ControlFunction = 'pauseRule' | 'resumeRule' | 'cancelRule';

/**
 * Writes the control transactions on the Agent. Every call simulates nothing first because the
 * control surface is small and the revert is shown by the component; success requires the Lasna
 * receipt, not a pending hash. Queries are invalidated after confirmation so the next render
 * reads chain truth rather than the optimistic value.
 */
export function useRuleControl(agent: Address | null) {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const write = useCallback(
    async (functionName: ControlFunction, ruleId: bigint): Promise<void> => {
      if (!agent) throw new Error('No automation account is connected.');
      if (chainId !== LASNA_CHAIN_ID) {
        await switchChainAsync({ chainId: LASNA_CHAIN_ID });
      }
      const hash = await writeContractAsync({
        address: agent,
        abi: agentAbi,
        functionName,
        args: [ruleId],
        chainId: LASNA_CHAIN_ID,
      });
      const receipt = await lasnaPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error('The transaction reverted on Lasna.');
      }
      await queryClient.invalidateQueries({ queryKey: ['rule', agent] });
      await queryClient.invalidateQueries({ queryKey: ['rules', agent] });
    },
    [agent, chainId, queryClient, switchChainAsync, writeContractAsync],
  );

  const reorder = useCallback(
    async (ids: bigint[]): Promise<void> => {
      if (!agent) throw new Error('No automation account is connected.');
      if (chainId !== LASNA_CHAIN_ID) {
        await switchChainAsync({ chainId: LASNA_CHAIN_ID });
      }
      const hash = await writeContractAsync({
        address: agent,
        abi: agentAbi,
        functionName: 'reorderRules',
        args: [ids],
        chainId: LASNA_CHAIN_ID,
      });
      const receipt = await lasnaPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error('The transaction reverted on Lasna.');
      }
      await queryClient.invalidateQueries({ queryKey: ['rules', agent] });
    },
    [agent, chainId, queryClient, switchChainAsync, writeContractAsync],
  );

  return {
    pause: (ruleId: bigint) => write('pauseRule', ruleId),
    resume: (ruleId: bigint) => write('resumeRule', ruleId),
    cancel: (ruleId: bigint) => write('cancelRule', ruleId),
    reorder,
  };
}
