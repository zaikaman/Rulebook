import {
  agentAbi,
  agentFactoryAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  vaultFactoryAbi,
  type Address,
} from '@rulebook/shared';
import { useRef } from 'react';
import {
  BaseError,
  ContractFunctionZeroDataError,
  isAddressEqual,
  parseEventLogs,
  zeroAddress,
  type Hex,
} from 'viem';
import { useSignTypedData, useWriteContract } from 'wagmi';

import {
  AGENT_FACTORY_ADDRESS,
  DEMO_USDC,
  DEMO_WETH,
  VAULT_FACTORY_ADDRESS,
} from '../lib/contracts.js';
import { SetupTransactionError } from '../lib/errors.js';
import { signatureDetails } from '../lib/signatures.js';
import { lasnaPublicClient, unichainPublicClient } from '../lib/wagmi.js';
import type { SetupWallet } from './useAccountSetup.js';
import { useChainGuard } from './useChainGuard.js';

interface ConfirmedDeployment {
  readonly owner: Address;
  readonly address: Address;
  readonly blockNumber: bigint;
}

async function waitForSetupReceipt(
  client: typeof lasnaPublicClient | typeof unichainPublicClient,
  hash: Hex,
  action: string,
) {
  const chainId = client.chain.id;
  const receipt = await client.waitForTransactionReceipt({ hash }).catch((error: unknown) => {
    throw new SetupTransactionError(
      chainId,
      hash,
      `Confirmation for ${action} is unavailable. Check the transaction before retrying.`,
      error,
    );
  });
  if (receipt.status === 'reverted') {
    throw new SetupTransactionError(
      chainId,
      receipt.transactionHash,
      `The transaction for ${action} reverted. Check the receipt before retrying.`,
    );
  }
  return receipt;
}

/** Execute only the setup steps the owner reviewed and started on the setup page. */
export function useSetupWallet(): SetupWallet {
  const requestSignature = useChainGuard();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const confirmed = useRef<{ agent?: ConfirmedDeployment; vault?: ConfirmedDeployment }>({});

  const getAgent: SetupWallet['getAgent'] = async (owner) => {
    if (!AGENT_FACTORY_ADDRESS) return null;
    const request = {
      address: AGENT_FACTORY_ADDRESS,
      abi: agentFactoryAbi,
      functionName: 'agentOf',
      args: [owner],
    } as const;
    let agent = await lasnaPublicClient.readContract(request);
    const deployment = confirmed.current.agent;
    if (agent === zeroAddress && deployment && isAddressEqual(deployment.owner, owner)) {
      agent = await lasnaPublicClient.readContract({
        ...request,
        blockNumber: deployment.blockNumber,
      });
    }
    return agent === zeroAddress ? null : agent;
  };
  const getVault: SetupWallet['getVault'] = async (owner) => {
    if (!VAULT_FACTORY_ADDRESS) return null;
    const request = {
      address: VAULT_FACTORY_ADDRESS,
      abi: vaultFactoryAbi,
      functionName: 'vaultOf',
      args: [owner],
    } as const;
    let vault = await unichainPublicClient.readContract(request);
    const deployment = confirmed.current.vault;
    if (vault === zeroAddress && deployment && isAddressEqual(deployment.owner, owner)) {
      vault = await unichainPublicClient.readContract({
        ...request,
        blockNumber: deployment.blockNumber,
      });
    }
    return vault === zeroAddress ? null : vault;
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
      return vault === zeroAddress ? null : vault;
    },
    getVaultAgent: async (vault) => {
      const request = { address: vault, abi: vaultAbi, functionName: 'agent' } as const;
      try {
        return await unichainPublicClient.readContract(request);
      } catch (error) {
        const deployment = confirmed.current.vault;
        if (
          !deployment ||
          !isAddressEqual(deployment.address, vault) ||
          !(error instanceof BaseError) ||
          !(
            error.walk((cause) => cause instanceof ContractFunctionZeroDataError) instanceof
            ContractFunctionZeroDataError
          )
        ) {
          throw error;
        }
        return unichainPublicClient.readContract({
          ...request,
          blockNumber: deployment.blockNumber,
        });
      }
    },
    createAgent: async (owner, reviewedConnector) => {
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
        (connector) =>
          writeContractAsync({
            connector,
            chainId: LASNA_CHAIN_ID,
            account: owner,
            address: factory,
            abi: agentFactoryAbi,
            functionName: 'deploy',
            args: [owner],
            maxPriorityFeePerGas: 1n,
          }),
        reviewedConnector,
      );
      const receipt = await waitForSetupReceipt(
        lasnaPublicClient,
        hash,
        'automation account creation',
      );
      // Read the confirmed result from the receipt. An RPC node's latest state can lag behind it.
      const deployment = parseEventLogs({
        abi: agentFactoryAbi,
        eventName: 'AgentDeployed',
        logs: receipt.logs,
      }).find(
        ({ address, args }) =>
          isAddressEqual(address, factory) &&
          isAddressEqual(args.owner, owner) &&
          args.agent !== zeroAddress,
      );
      if (!deployment)
        throw new SetupTransactionError(
          LASNA_CHAIN_ID,
          receipt.transactionHash,
          'This transaction did not record an automation account for your wallet.',
        );
      confirmed.current.agent = {
        owner,
        address: deployment.args.agent,
        blockNumber: receipt.blockNumber,
      };
      return deployment.args.agent;
    },
    createVault: async (owner: Address, agent, reviewedConnector, vaultMode) => {
      const factory = VAULT_FACTORY_ADDRESS;
      if (!factory) throw new Error('Vault factory is not configured.');
      const nonce = await unichainPublicClient.readContract({
        address: factory,
        abi: vaultFactoryAbi,
        functionName: 'nonces',
        args: [owner],
      });
      const authorization = await requestSignature(
        signatureDetails.authorizeVault(factory, agent, vaultMode),
        owner,
        async (connector) => {
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
            connector,
            account: owner,
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
        reviewedConnector,
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
        (connector) =>
          writeContractAsync({
            connector,
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
        reviewedConnector,
      );
      const receipt = await waitForSetupReceipt(unichainPublicClient, hash, 'vault creation');
      const deployment = parseEventLogs({
        abi: vaultFactoryAbi,
        eventName: 'VaultDeployed',
        logs: receipt.logs,
      }).find(
        ({ address, args }) =>
          isAddressEqual(address, factory) &&
          isAddressEqual(args.owner, owner) &&
          isAddressEqual(args.agent, agent) &&
          args.chainId === BigInt(UNICHAIN_SEPOLIA_CHAIN_ID) &&
          args.vault !== zeroAddress,
      );
      if (!deployment)
        throw new SetupTransactionError(
          UNICHAIN_SEPOLIA_CHAIN_ID,
          receipt.transactionHash,
          'This transaction did not record a vault for your wallet and automation account.',
        );
      confirmed.current.vault = {
        owner,
        address: deployment.args.vault,
        blockNumber: receipt.blockNumber,
      };
      return deployment.args.vault;
    },
    linkVault: async (owner, agent, vault, destinationChainId, reviewedConnector) => {
      const hash = await requestSignature(
        signatureDetails.linkVault(agent, vault),
        owner,
        (connector) =>
          writeContractAsync({
            connector,
            address: agent,
            account: owner,
            abi: agentAbi,
            functionName: 'linkVault',
            args: [BigInt(destinationChainId), vault],
            chainId: LASNA_CHAIN_ID,
            maxPriorityFeePerGas: 1n,
          }),
        reviewedConnector,
      );
      const receipt = await waitForSetupReceipt(lasnaPublicClient, hash, 'account linking');
      const linked = parseEventLogs({
        abi: agentAbi,
        eventName: 'VaultLinked',
        logs: receipt.logs,
      }).some(
        ({ address, args }) =>
          isAddressEqual(address, agent) &&
          isAddressEqual(args.vault, vault) &&
          args.chainId === BigInt(destinationChainId),
      );
      if (!linked)
        throw new SetupTransactionError(
          LASNA_CHAIN_ID,
          receipt.transactionHash,
          'This transaction did not record a link between your automation account and vault.',
        );
    },
  };
}
