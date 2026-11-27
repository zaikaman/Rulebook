import { UNICHAIN_SEPOLIA_CHAIN_ID, type Address, type FundsChainId } from '@rulebook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isAddressEqual } from 'viem';

export interface SetupWallet {
  getAgent(owner: Address): Promise<Address | null>;
  getVault(owner: Address): Promise<Address | null>;
  getLink(agent: Address): Promise<Address | null>;
  getVaultAgent(vault: Address): Promise<Address>;
  createAgent(owner: Address, reviewedConnector: string): Promise<Address>;
  /** Returns a vault whose deployment was confirmed for this owner and Agent. */
  createVault(
    owner: Address,
    agent: Address,
    reviewedConnector: string,
    mode?: 'mirror',
  ): Promise<Address>;
  linkVault(
    owner: Address,
    agent: Address,
    vault: Address,
    chainId: number,
    reviewedConnector: string,
  ): Promise<void>;
}

export type SetupStep = 'agent' | 'vault' | 'link';

interface AccountSetupState {
  agent: Address | null;
  vault: Address | null;
  linked: boolean;
}

export function remainingSetupSteps({ agent, vault, linked }: AccountSetupState): SetupStep[] {
  if (linked) return [];
  const steps: SetupStep[] = [];
  if (!agent) steps.push('agent');
  if (!vault) steps.push('vault');
  steps.push('link');
  return steps;
}

interface ReviewedSetup {
  readonly steps: readonly SetupStep[];
  readonly connectorUid: string;
  readonly mode?: 'mirror';
}

async function readSetup(owner: Address, wallet: SetupWallet) {
  const [agent, vault] = await Promise.all([wallet.getAgent(owner), wallet.getVault(owner)]);
  if (!agent || !vault) return { agent, vault, linked: false };
  const link = await wallet.getLink(agent);
  const linked = !!link && isAddressEqual(link, vault);
  if (linked && !isAddressEqual(await wallet.getVaultAgent(vault), agent)) {
    throw new Error('This vault is linked to a different automation account.');
  }
  return { agent, vault, linked };
}

/** Read the factories on-chain before each retry so confirmed steps are never submitted twice. */
export function useAccountSetup({
  owner,
  wallet,
  scope,
  chainId = UNICHAIN_SEPOLIA_CHAIN_ID,
}: {
  owner?: Address;
  wallet: SetupWallet;
  scope?: string;
  chainId?: FundsChainId;
}) {
  const queryClient = useQueryClient();
  const key = ['wallet-setup', owner, scope, chainId];
  const account = useQuery({
    queryKey: key,
    enabled: !!owner,
    queryFn: () => readSetup(owner!, wallet),
    retry: false,
  });
  const setup = useMutation({
    mutationKey: key,
    mutationFn: async ({ steps, connectorUid, mode }: ReviewedSetup) => {
      if (!owner) throw new Error('Connect your wallet to create an account.');
      const current = await readSetup(owner, wallet);
      if (current.linked) return current;
      if (remainingSetupSteps(current).some((step) => !steps.includes(step))) {
        queryClient.setQueryData(key, current);
        throw new Error('The remaining setup steps changed. Review them and continue.');
      }
      const agent = current.agent ?? (await wallet.createAgent(owner, connectorUid));
      queryClient.setQueryData(key, { ...current, agent });
      const vault = current.vault ?? (await wallet.createVault(owner, agent, connectorUid, mode));
      queryClient.setQueryData(key, { ...current, agent, vault });
      if (current.vault && !isAddressEqual(await wallet.getVaultAgent(current.vault), agent)) {
        throw new Error('This vault is linked to a different automation account.');
      }
      await wallet.linkVault(owner, agent, vault, chainId, connectorUid);
      return { agent, vault, linked: true };
    },
    onSuccess: async (result) => {
      // Do not let an in-flight lookup from a lagging RPC node replace confirmed progress.
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, result);
    },
    onSettled: async (_result, error) => {
      await Promise.all([
        error && queryClient.invalidateQueries({ queryKey: key, exact: true }),
        queryClient.invalidateQueries({ queryKey: ['balance'] }),
        queryClient.invalidateQueries({ queryKey: ['readContract'] }),
        queryClient.invalidateQueries({ queryKey: ['mirror-account', owner] }),
        scope &&
          queryClient.invalidateQueries({
            predicate: (query) =>
              query.queryKey[0] === 'workflow-v2' && query.queryKey[1] !== 'linked-account',
          }),
      ]);
    },
  });

  const resetSetup = setup.reset;
  useEffect(() => {
    resetSetup();
  }, [owner, scope, chainId, resetSetup]);

  return {
    ...account,
    resume: setup.mutate,
    resuming: setup.isPending,
    setupSucceeded: setup.isSuccess,
    setupError: setup.error,
  };
}
