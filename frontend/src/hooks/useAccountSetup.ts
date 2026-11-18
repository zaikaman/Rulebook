import { UNICHAIN_SEPOLIA_CHAIN_ID, type Address } from '@rulebook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAddressEqual } from 'viem';

export interface SetupWallet {
  getAgent(owner: Address): Promise<Address | null>;
  getVault(owner: Address): Promise<Address | null>;
  getLink(agent: Address): Promise<Address | null>;
  getVaultAgent(vault: Address): Promise<Address>;
  createAgent(owner: Address): Promise<Address>;
  createVault(owner: Address, agent: Address, mode?: 'mirror'): Promise<Address>;
  linkVault(agent: Address, vault: Address, chainId: number): Promise<void>;
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
export function useAccountSetup({ owner, wallet }: { owner?: Address; wallet: SetupWallet }) {
  const queryClient = useQueryClient();
  const key = ['wallet-setup', owner];
  const account = useQuery({
    queryKey: key,
    enabled: !!owner,
    queryFn: () => readSetup(owner!, wallet),
    retry: false,
  });
  const setup = useMutation({
    mutationFn: async (mode?: 'mirror') => {
      if (!owner) throw new Error('Connect your wallet to create an account.');
      const current = await readSetup(owner, wallet);
      if (current.linked) return current;
      const agent = current.agent ?? (await wallet.createAgent(owner));
      const vault = current.vault ?? (await wallet.createVault(owner, agent, mode));
      if (!isAddressEqual(await wallet.getVaultAgent(vault), agent)) {
        throw new Error('This vault is linked to a different automation account.');
      }
      await wallet.linkVault(agent, vault, UNICHAIN_SEPOLIA_CHAIN_ID);
      return { agent, vault, linked: true };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(key, result);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ['readContract'] }),
        queryClient.invalidateQueries({ queryKey: ['mirror-account', owner] }),
      ]);
    },
  });

  return { ...account, resume: setup.mutate, resuming: setup.isPending, setupError: setup.error };
}
