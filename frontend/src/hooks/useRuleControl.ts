import { agentAbi, LASNA_CHAIN_ID, type Address } from '@rulebook/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ContractFunctionArgs } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';

import { signatureDetails, signatureTokenAmount, type ControlFunction } from '../lib/signatures.js';
import { lasnaPublicClient } from '../lib/wagmi.js';
import { useChainGuard } from './useChainGuard.js';

type MirrorConfig = ContractFunctionArgs<typeof agentAbi, 'nonpayable', 'addMirror'>[1];

/**
 * Writes the control transactions on the Agent. Every call simulates nothing first because the
 * control surface is small and the revert is shown by the component; success requires the Lasna
 * receipt, not a pending hash. Queries are invalidated after confirmation so the next render
 * reads chain truth rather than the optimistic value.
 */
export function useRuleControl(agent: Address | null) {
  const { address } = useAccount();
  const requestSignature = useChainGuard();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const confirm = useCallback(
    async (hash: `0x${string}`): Promise<void> => {
      const receipt = await lasnaPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success')
        throw new Error('The transaction reverted on Reactive Lasna.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rule', agent] }),
        queryClient.invalidateQueries({ queryKey: ['rules', agent] }),
      ]);
    },
    [agent, queryClient],
  );

  const write = useCallback(
    async (functionName: ControlFunction, ruleId: bigint): Promise<void> => {
      if (!agent) throw new Error('No automation account is connected.');
      const hash = await requestSignature(
        signatureDetails.control(agent, functionName, ruleId),
        address,
        () =>
          writeContractAsync({
            address: agent,
            account: address,
            abi: agentAbi,
            functionName,
            args: [ruleId],
            chainId: LASNA_CHAIN_ID,
          }),
      );
      await confirm(hash);
    },
    [address, agent, confirm, requestSignature, writeContractAsync],
  );

  const reorder = useCallback(
    async (ids: bigint[]): Promise<void> => {
      if (!agent) throw new Error('No automation account is connected.');
      const hash = await requestSignature(signatureDetails.reorder(agent, ids), address, () =>
        writeContractAsync({
          address: agent,
          account: address,
          abi: agentAbi,
          functionName: 'reorderRules',
          args: [ids],
          chainId: LASNA_CHAIN_ID,
        }),
      );
      await confirm(hash);
    },
    [address, agent, confirm, requestSignature, writeContractAsync],
  );

  const attachMirror = useCallback(
    async (
      ruleId: bigint,
      config: MirrorConfig,
      fundsChainId: number,
      tokenIn: Address,
    ): Promise<void> => {
      if (!agent) throw new Error('No automation account is connected.');
      const cap = signatureTokenAmount(fundsChainId, tokenIn, config.perRunCap);
      const hash = await requestSignature(
        signatureDetails.mirror(agent, ruleId, config, cap),
        address,
        () =>
          writeContractAsync({
            address: agent,
            account: address,
            abi: agentAbi,
            functionName: 'addMirror',
            args: [ruleId, config],
            chainId: LASNA_CHAIN_ID,
          }),
      );
      await confirm(hash);
    },
    [address, agent, confirm, requestSignature, writeContractAsync],
  );

  return {
    pause: (ruleId: bigint) => write('pauseRule', ruleId),
    resume: (ruleId: bigint) => write('resumeRule', ruleId),
    cancel: (ruleId: bigint) => write('cancelRule', ruleId),
    reorder,
    attachMirror,
    detachMirror: (ruleId: bigint) => write('detachMirror', ruleId),
  };
}
