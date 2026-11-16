import {
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Account,
  type Address,
  type OnboardingResponse,
  type SetupState,
  type StarterFundsResponse,
} from '@rulebook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../lib/api.js';

/** The API surface onboarding needs; injected so the hook is testable without a server. */
export interface AccountSetupApi {
  account(agent: string): Promise<Account>;
  onboarding(owner: Address): Promise<OnboardingResponse>;
  starterFunds(owner: Address, vault: Address): Promise<StarterFundsResponse>;
}

/**
 * Wallet actions onboarding needs. `linkVault` resolves only after the Lasna transaction is
 * confirmed, so the account query never reports `complete` from a pending signature.
 */
export interface SetupWallet {
  readonly address?: Address;
  readonly chainId?: number;
  getAgent(owner: Address): Promise<Address | null>;
  getVault(owner: Address): Promise<Address | null>;
  switchToLasna(): Promise<void>;
  linkVault(agent: Address, vault: Address, chainId: number): Promise<`0x${string}`>;
}

export interface AccountSetupOptions {
  readonly owner?: Address;
  readonly api: AccountSetupApi;
  readonly wallet: SetupWallet;
}

export interface AccountSetup {
  readonly setupState: SetupState;
  readonly agent: Address | null;
  readonly vault: Address | null;
  readonly account: Account | null;
  readonly result: OnboardingResponse | null;
  readonly starterFunds: StarterFundsResponse | null;
  readonly resume: () => Promise<OnboardingResponse | null>;
  readonly claimStarterFunds: () => Promise<StarterFundsResponse>;
  readonly resuming: boolean;
  readonly claiming: boolean;
  readonly error: Error | null;
}

/**
 * Resolves the setup state, resumes only the missing step, and polls until the Agent reports
 * the vault link. A completed account is never sent through onboarding again (FR-004).
 */
export function useAccountSetup({ owner, api, wallet }: AccountSetupOptions): AccountSetup {
  const queryClient = useQueryClient();

  const agentQuery = useQuery({
    queryKey: ['agentOf', owner, wallet.address],
    queryFn: async () => (owner ? wallet.getAgent(owner) : null),
    enabled: Boolean(owner),
  });

  const agent = agentQuery.data ?? null;
  const accountQuery = useQuery({
    queryKey: ['account', agent],
    queryFn: () => api.account(agent as string),
    enabled: Boolean(agent),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    refetchInterval: (query) => (query.state.data?.setup_state === 'complete' ? false : 5_000),
  });

  const account = accountQuery.data ?? null;
  const setupState: SetupState = account?.setup_state ?? (agent ? 'agent_only' : 'none');

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!owner) throw new Error('Connect a wallet before creating an account.');
      if (setupState === 'complete') return null;

      const result = await api.onboarding(owner);
      if (result.setup_state === 'partial' && result.agent && result.vault) {
        if (wallet.chainId !== LASNA_CHAIN_ID) await wallet.switchToLasna();
        await wallet.linkVault(result.agent, result.vault, UNICHAIN_SEPOLIA_CHAIN_ID);
      }
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agentOf'] });
      await queryClient.invalidateQueries({ queryKey: ['account'] });
    },
  });

  const vaultFromResult = resumeMutation.data?.vault ?? null;
  const vault = account?.vaults[0]?.address ?? vaultFromResult;

  const starterMutation = useMutation({
    mutationFn: async () => {
      if (!owner) throw new Error('Connect a wallet before claiming starter funds.');
      if (!vault) throw new Error('Create your vault before claiming starter funds.');
      return api.starterFunds(owner, vault);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['account'] });
    },
  });

  const error = resumeMutation.error ?? starterMutation.error ?? accountQuery.error ?? null;

  return {
    setupState,
    agent,
    vault,
    account,
    result: resumeMutation.data ?? null,
    starterFunds: starterMutation.data ?? null,
    resume: resumeMutation.mutateAsync,
    claimStarterFunds: starterMutation.mutateAsync,
    resuming: resumeMutation.isPending,
    claiming: starterMutation.isPending,
    error: error instanceof Error ? error : null,
  };
}
