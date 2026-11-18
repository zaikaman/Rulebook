import {
  agentAbi,
  agentFactoryAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultFactoryAbi,
  type Address,
} from '@rulebook/shared';
import { useAccount, useSignTypedData, useWriteContract } from 'wagmi';

import {
  AGENT_FACTORY_ADDRESS,
  DEMO_USDC,
  DEMO_WETH,
  VAULT_FACTORY_ADDRESS,
} from '../lib/contracts.js';
import { signatureDetails } from '../lib/signatures.js';
import { lasnaPublicClient, unichainPublicClient } from '../lib/wagmi.js';
import type { SetupWallet } from './useAccountSetup.js';
import { useChainGuard } from './useChainGuard.js';

const ZERO = '0x0000000000000000000000000000000000000000';

/** Adapter from wagmi to the framework-free setup hook. Never switches without asking. */
export function useSetupWallet(): SetupWallet {
  const { address } = useAccount();
  const requestSignature = useChainGuard();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  return {
    ...(address ? { address: address.toLowerCase() as Address } : {}),
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
    authorizeVault: async (owner, agent, vaultMode) => {
      if (!address) throw new Error('Connect the wallet that owns this Agent.');
      if (address.toLowerCase() !== owner.toLowerCase()) {
        throw new Error('The connected wallet must match the account owner.');
      }
      const factory = VAULT_FACTORY_ADDRESS;
      if (!factory) throw new Error('Vault factory is not configured.');
      const nonce = await unichainPublicClient.readContract({
        address: factory,
        abi: vaultFactoryAbi,
        functionName: 'nonces',
        args: [address],
      });
      return requestSignature(
        signatureDetails.authorizeVault(factory, agent, vaultMode),
        address,
        async () => {
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
          const authorizationFields = [
            { name: 'owner', type: 'address' },
            { name: 'agent', type: 'address' },
            { name: 'tokenIn', type: 'address' },
            { name: 'tokenOut', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ] as const;
          const signature = await signTypedDataAsync({
            account: address,
            domain: {
              name: 'Rulebook Vault Factory',
              version: '1',
              chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
              verifyingContract: factory,
            },
            types:
              vaultMode === 'mirror'
                ? { MirrorVaultDeployment: authorizationFields }
                : { VaultDeployment: authorizationFields },
            primaryType: vaultMode === 'mirror' ? 'MirrorVaultDeployment' : 'VaultDeployment',
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
      );
    },
    linkVault: async (agent, vault, destinationChainId) => {
      const hash = await requestSignature(signatureDetails.linkVault(agent, vault), address, () =>
        writeContractAsync({
          address: agent,
          account: address,
          abi: agentAbi,
          functionName: 'linkVault',
          args: [BigInt(destinationChainId), vault],
          chainId: LASNA_CHAIN_ID,
          maxPriorityFeePerGas: 1n,
        }),
      );
      const receipt = await lasnaPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success')
        throw new Error('The account link reverted on Reactive Lasna.');
      return hash;
    },
  };
}
