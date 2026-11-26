import { SUPPORTED_CHAIN_IDS, type Address } from '@rulebook/shared';
import {
  MethodNotFoundRpcError,
  numberToHex,
  UnsupportedProviderMethodError,
  type AddEthereumChainParameter,
  type EIP1193Provider,
  type WalletPermission,
} from 'viem';
import type { Connector } from 'wagmi';

export function permittedSetupChains(
  permissions: readonly WalletPermission[] | null | undefined,
  chains: readonly number[] = SUPPORTED_CHAIN_IDS,
) {
  const declared: readonly WalletPermission[] = Array.isArray(permissions) ? permissions : [];
  const chainIds: unknown = declared
    .find((permission) => permission.parentCapability === 'endowment:permitted-chains')
    ?.caveats?.find(({ type }) => type === 'restrictNetworkSwitching')?.value;
  return Array.isArray(chainIds)
    ? chains.filter((id) => chainIds.includes(numberToHex(id)))
    : undefined;
}

export function isUnsupportedWalletMethod(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === UnsupportedProviderMethodError.code ||
      error.code === MethodNotFoundRpcError.code)
  );
}

export async function allowSetupNetwork(
  provider: EIP1193Provider,
  chain: AddEthereumChainParameter,
  checkWallet: () => void,
) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chain.chainId }],
    });
    return;
  } catch (error) {
    // MetaMask Mobile may nest the unknown-chain code in the RPC error.
    const rpcError = error as {
      code?: number;
      data?: { originalError?: { code?: number } };
    } | null;
    if (
      rpcError?.code !== 4902 &&
      rpcError?.data?.originalError?.code !== 4902 &&
      !isUnsupportedWalletMethod(error)
    ) {
      throw error;
    }
  }

  checkWallet();
  await provider.request({ method: 'wallet_addEthereumChain', params: [chain] });
}

export async function checkSetupNetworks(
  connector: Pick<Connector, 'type' | 'getProvider' | 'getChainId'>,
  owner: Address,
  chains: readonly number[] = SUPPORTED_CHAIN_IDS,
) {
  if (connector.type === 'walletConnect') {
    const provider = (await connector.getProvider()) as
      { session?: { namespaces: Record<string, { accounts: readonly string[] }> } } | undefined;
    const accounts = Object.values(provider?.session?.namespaces ?? {})
      .flatMap((namespace) => namespace.accounts)
      .map((account) => account.toLowerCase());
    return chains.filter((id) => accounts.includes(`eip155:${id}:${owner.toLowerCase()}`));
  }

  const provider = (await connector.getProvider()) as EIP1193Provider | undefined;
  if (!provider) throw new Error('The browser wallet is unavailable.');

  // Some wallets only expose account permissions. A failed read can still use the active chain.
  try {
    const allowed = permittedSetupChains(
      await provider.request({ method: 'wallet_getPermissions' }),
      chains,
    );
    if (allowed) return allowed;
  } catch {
    // Let the user confirm the other network in their wallet.
  }
  const currentChain = await connector.getChainId();
  return chains.filter((id) => currentChain === id);
}
