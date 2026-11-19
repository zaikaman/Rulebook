import {
  agentAbi,
  getTemplate,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type Rule,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { erc20Abi, zeroAddress } from 'viem';

import { signatureTokenAmount } from '../lib/signatures.js';
import { lasnaPublicClient, unichainPublicClient } from '../lib/wagmi.js';

export function useRuleFunds(agent: Address, rule: Rule | undefined, enabled: boolean) {
  const chain = rule?.chain_id;
  const token = rule?.token_in;
  const amount = rule?.amount_in;
  const query = useQuery({
    queryKey: ['rule-funds', agent.toLowerCase(), chain, token],
    enabled:
      enabled &&
      chain === UNICHAIN_SEPOLIA_CHAIN_ID &&
      !!token &&
      amount !== undefined &&
      !!rule &&
      getTemplate(rule.template)?.action === 'swap',
    queryFn: async () => {
      if (chain === undefined || !token) return null;
      const vault = await lasnaPublicClient.readContract({
        address: agent,
        abi: agentAbi,
        functionName: 'getVault',
        args: [BigInt(chain)],
      });
      if (vault === zeroAddress) return null;
      const balance = await unichainPublicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [vault],
      });
      return { vault, balance };
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const reading = query.data;
  if (
    !enabled ||
    query.isError ||
    !reading ||
    chain === undefined ||
    amount === undefined ||
    !token ||
    reading.balance >= amount
  ) {
    return null;
  }
  return {
    vault: reading.vault,
    token,
    available: signatureTokenAmount(chain, token, reading.balance),
    required: signatureTokenAmount(chain, token, amount),
  };
}
