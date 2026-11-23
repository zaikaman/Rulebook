import type { Address } from '@rulebook/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BaseError } from 'viem';
import { useAccount } from 'wagmi';

import { useAccountSetup, type SetupWallet } from '../hooks/useAccountSetup.js';
import { appRoutes } from '../lib/routes.js';
import { CreateAccount } from '../pages/CreateAccount.js';
import { AppShell } from './AppShell.js';
import { ErrorState } from './ErrorState.js';
import { PageHeading } from './chrome/PageHeading.js';
import { Spinner } from './chrome/Spinner.js';

interface GateProps {
  title: string;
  children: (accounts: { agent: Address; vault: Address }) => ReactNode;
}

/** Requires a confirmed Workflow V2 Agent and Vault before rendering the workspace. */
export function WalletAccountSetupGate({
  title,
  children,
  wallet,
  workflowScope,
}: GateProps & {
  wallet: SetupWallet;
  workflowScope?: string;
}) {
  const { address, isReconnecting } = useAccount();
  const owner = isReconnecting ? undefined : (address?.toLowerCase() as Address | undefined);
  const setup = useAccountSetup({ owner, wallet, scope: workflowScope });
  const { agent, vault, linked } = setup.data ?? {};

  if (isReconnecting || (owner && !setup.data)) {
    const error = setup.error;
    return (
      <AppShell>
        <section className="app-page">
          <PageHeading title={title} />
          {error ? (
            <ErrorState
              message="Your account status could not be loaded."
              detail={error instanceof BaseError ? error.shortMessage : error.message}
              onRetry={() => void setup.refetch()}
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

  if (!owner || !agent || !vault || !linked) {
    return (
      <AppShell focused>
        <CreateAccount key={owner} setup={setup} />
      </AppShell>
    );
  }

  return children({ agent, vault });
}
