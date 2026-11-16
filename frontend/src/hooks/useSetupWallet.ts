import {
  agentAbi,
  agentFactoryAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultFactoryAbi,
  type Address,
} from '@rulebook/shared';
import { useAccount, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi';

import {
  AGENT_FACTORY_ADDRESS,
  DEMO_USDC,
  DEMO_WETH,
  VAULT_FACTORY_ADDRESS,
} from '../lib/contracts.js';
import { lasnaPublicClient, unichainPublicClient } from '../lib/wagmi.js';
import type { SetupWallet } from './useAccountSetup.js';

const ZERO = '0x0000000000000000000000000000000000000000';

/** Adapter from wagmi to the framework-free setup hook. Never switches without asking. */
export function useSetupWallet(): SetupWallet {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

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
    authorizeVault: async (owner, agent) => {
      if (!address) throw new Error('Connect the wallet that owns this Agent.');
      if (address.toLowerCase() !== owner.toLowerCase()) {
        throw new Error('The connected wallet must match the account owner.');
      }
      if (!VAULT_FACTORY_ADDRESS) throw new Error('Vault factory is not configured.');
      await switchChainAsync({ chainId: UNICHAIN_SEPOLIA_CHAIN_ID });
      const nonce = await unichainPublicClient.readContract({
        address: VAULT_FACTORY_ADDRESS,
        abi: vaultFactoryAbi,
        functionName: 'nonces',
        args: [address],
      });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
      const signature = await signTypedDataAsync({
        domain: {
          name: 'Rulebook Vault Factory',
          version: '1',
          chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
          verifyingContract: VAULT_FACTORY_ADDRESS,
        },
        types: {
          VaultDeployment: [
            { name: 'owner', type: 'address' },
            { name: 'agent', type: 'address' },
            { name: 'tokenIn', type: 'address' },
            { name: 'tokenOut', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'VaultDeployment',
        message: {
          owner,
          agent,
          tokenIn: DEMO_USDC,
          tokenOut: DEMO_WETH,
          nonce,
          deadline,
        },
      });
      return { deadline: deadline.toString(), signature };
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
        maxPriorityFeePerGas: 1n,
      });
      await lasnaPublicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}
