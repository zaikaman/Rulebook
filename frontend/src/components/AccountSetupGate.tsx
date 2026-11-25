import { UNICHAIN_SEPOLIA_CHAIN_ID, type Address, type FundsChainId } from '@rulebook/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BaseError } from 'viem';
import { useAccount } from 'wagmi';

import type { SetupFundingWallet } from '../hooks/useAccountFunding.js';
import { useAccountSetup, type SetupWallet } from '../hooks/useAccountSetup.js';
import { appRoutes } from '../lib/routes.js';
import { CreateAccount } from '../pages/CreateAccount.js';
import { AppShell } from './AppShell.js';
import { ErrorState } from './ErrorState.js';
import { PageHeading } from './chrome/PageHeading.js';
import { Spinner } from './chrome/Spinner.js';

export interface LinkedAccount {
  readonly agent: Address;
  readonly vault: Address;
  readonly chain: FundsChainId;
}

interface GateProps {
  title: string;
  children: (accounts: LinkedAccount) => ReactNode;
}

/** Requires a confirmed Workflow V2 Agent and Vault before rendering the workspace. */
export function WalletAccountSetupGate({
  title,
  children,
  wallet,
  chainId = UNICHAIN_SEPOLIA_CHAIN_ID,
  availableChains,
  onChainChange,
  findLinkedChain,
  fundingWallet,
  startWorkflow = false,
  workflowScope,
}: GateProps & {
  wallet: SetupWallet;
  chainId?: FundsChainId;
  availableChains?: readonly FundsChainId[];
  onChainChange?: (chain: FundsChainId) => void;
  findLinkedChain?: (owner: Address) => Promise<LinkedAccount | null>;
  fundingWallet?: SetupFundingWallet;
  startWorkflow?: boolean;
  workflowScope?: string;
}) {
  const { address, isReconnecting } = useAccount();
  const queryClient = useQueryClient();
  const owner = isReconnecting ? undefined : (address?.toLowerCase() as Address | undefined);
  const setup = useAccountSetup({ owner, wallet, scope: workflowScope, chainId });
  const existingLinked = useQuery({
    queryKey: ['wallet-setup-linked-chain', owner, workflowScope],
    enabled: Boolean(owner && findLinkedChain),
    queryFn: () => findLinkedChain!(owner!),
    retry: false,
  });
  const { agent, vault, linked } = setup.data ?? {};
  const [fundingDoneFor, setFundingDoneFor] = useState<Address>();
  const showFunding =
    Boolean(fundingWallet && owner && agent && vault && linked) &&
    (setup.resuming || setup.setupSucceeded) &&
    fundingDoneFor !== owner;

  if (
    isReconnecting ||
    (owner &&
      (!setup.data ||
        (Boolean(findLinkedChain) && (existingLinked.isLoading || existingLinked.isError))))
  ) {
    const error = setup.error ?? existingLinked.error;
    return (
      <AppShell>
        <section className="app-page">
          <PageHeading title={title} />
          {error ? (
            <ErrorState
              message="Your account status could not be loaded."
              detail={error instanceof BaseError ? error.shortMessage : error.message}
              onRetry={() => {
                void setup.refetch();
                if (findLinkedChain) void existingLinked.refetch();
              }}
            >
              <Link to={appRoutes.accountFunds} className="app-link">
                Manage existing vault funds
              </Link>
            </ErrorState>
          ) : (
            <p className="rb-loading" role="status">
              <Spinner />
              {isReconnecting ? 'Reconnecting your wallet…' : 'Checking for an existing account…'}
            </p>
          )}
        </section>
      </AppShell>
    );
  }

  if (!setup.resuming && !setup.setupSucceeded && owner && existingLinked.data) {
    return children(existingLinked.data);
  }

  if (!owner || !agent || !vault || !linked || showFunding) {
    return (
      <AppShell focused>
        <CreateAccount
          key={owner}
          setup={setup}
          chainId={chainId}
          availableChains={availableChains}
          onChainChange={onChainChange}
          fundingWallet={fundingWallet}
          startWorkflow={startWorkflow}
          onFundingComplete={
            owner
              ? () => {
                  setFundingDoneFor(owner);
                  void queryClient.invalidateQueries({
                    queryKey: ['wallet-setup-linked-chain', owner],
                  });
                }
              : undefined
          }
        />
      </AppShell>
    );
  }

  return children({ agent, vault, chain: chainId });
}
