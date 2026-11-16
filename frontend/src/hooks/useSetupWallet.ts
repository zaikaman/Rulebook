import {
  agentAbi,
  agentFactoryAbi,
  LASNA_CHAIN_ID,
  vaultFactoryAbi,
  type Address,
} from '@rulebook/shared';
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi';

import { AGENT_FACTORY_ADDRESS, VAULT_FACTORY_ADDRESS } from '../lib/contracts.js';
import { lasnaPublicClient, unichainPublicClient } from '../lib/wagmi.js';
import type { SetupWallet } from './useAccountSetup.js';

const ZERO = '0x0000000000000000000000000000000000000000';

/** Adapter from wagmi to the framework-free setup hook. Never switches without asking. */
export function useSetupWallet(): SetupWallet {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  return {
    ...(address ? { address: address.toLowerCase() as Address } : {}),
    ...(chainId !== undefined ? { chainId } : {}),
    getAgent: async (owner) => {
      if (!AGENT_FACTORY_ADDRESS) return null;
      const agent = await lasnaPublicClient.readContract({
        address: AGENT_FACTORY_ADDRESS,
        abi: agentFactoryAbi,
        functionName: 'agentOf',
        args: [owner],
      });
      return agent === ZERO ? null : agent;
    },
    getVault: async (owner) => {
      if (!VAULT_FACTORY_ADDRESS) return null;
      const vault = await unichainPublicClient.readContract({
        address: VAULT_FACTORY_ADDRESS,
        abi: vaultFactoryAbi,
        functionName: 'vaultOf',
        args: [owner],
      });
      return vault === ZERO ? null : vault;
    },
    switchToLasna: async () => {
      await switchChainAsync({ chainId: LASNA_CHAIN_ID });
    },
    linkVault: async (agent, vault, destinationChainId) => {
      const hash = await writeContractAsync({
        address: agent,
        abi: agentAbi,
        functionName: 'linkVault',
        args: [BigInt(destinationChainId), vault],
        chainId: LASNA_CHAIN_ID,
      });
      await lasnaPublicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}
