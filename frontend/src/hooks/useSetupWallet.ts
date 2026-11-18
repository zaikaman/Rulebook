import {
  agentAbi,
  agentFactoryAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
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

  const getAgent: SetupWallet['getAgent'] = async (owner) => {
    if (!AGENT_FACTORY_ADDRESS) return null;
    const agent = await lasnaPublicClient.readContract({
      address: AGENT_FACTORY_ADDRESS,
      abi: agentFactoryAbi,
      functionName: 'agentOf',
      args: [owner],
    });
    return agent === ZERO ? null : agent;
  };
  const getVault: SetupWallet['getVault'] = async (owner) => {
    if (!VAULT_FACTORY_ADDRESS) return null;
    const vault = await unichainPublicClient.readContract({
      address: VAULT_FACTORY_ADDRESS,
      abi: vaultFactoryAbi,
      functionName: 'vaultOf',
      args: [owner],
    });
    return vault === ZERO ? null : vault;
  };

  return {
    getAgent,
    getVault,
    getLink: async (agent) => {
      const vault = await lasnaPublicClient.readContract({
        address: agent,
        abi: agentAbi,
        functionName: 'getVault',
        args: [BigInt(UNICHAIN_SEPOLIA_CHAIN_ID)],
      });
      return vault === ZERO ? null : vault;
    },
    getVaultAgent: (vault) =>
      unichainPublicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'agent' }),
    createAgent: async (owner) => {
      const factory = AGENT_FACTORY_ADDRESS;
      if (!factory) throw new Error('The automation factory is unavailable.');
      const hash = await requestSignature(
        {
          chainId: LASNA_CHAIN_ID,
          target: factory,
          targetLabel: 'Automation account factory',
          effect: 'Create the automation account owned by your wallet.',
          amount: 'No funds are deposited.',
        },
        owner,
        () =>
          writeContractAsync({
            chainId: LASNA_CHAIN_ID,
            account: owner,
            address: factory,
            abi: agentFactoryAbi,
            functionName: 'deploy',
            args: [owner],
            maxPriorityFeePerGas: 1n,
          }),
      );
      const receipt = await lasnaPublicClient.waitForTransactionReceipt({ hash });
      const agent = await getAgent(owner);
      if (receipt.status !== 'success' || !agent)
        throw new Error('The automation account creation did not complete.');
      return agent;
    },
    createVault: async (owner: Address, agent, vaultMode) => {
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
      const authorization = await requestSignature(
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
          return { deadline, signature };
        },
      );
      const hash = await requestSignature(
        {
          chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
          target: factory,
          targetLabel: 'Vault factory',
          effect: 'Create the vault owned by your wallet.',
          amount: 'No funds are deposited.',
        },
        owner,
        () =>
          writeContractAsync({
            chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
            account: owner,
            address: factory,
            abi: vaultFactoryAbi,
            functionName: vaultMode === 'mirror' ? 'deployMirror' : 'deploy',
            args: [
              owner,
              agent,
              DEMO_USDC,
              DEMO_WETH,
              authorization.deadline,
              authorization.signature,
            ],
          }),
      );
      const receipt = await unichainPublicClient.waitForTransactionReceipt({ hash });
      const vault = await getVault(owner);
      if (receipt.status !== 'success' || !vault)
        throw new Error('The vault creation did not complete.');
      return vault;
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
    },
  };
}
