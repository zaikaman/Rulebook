import type { Address } from '@rulebook/shared';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { BaseError } from 'viem';
import { useAccount } from 'wagmi';

import { useAccountSetup, type SetupWallet } from '../hooks/useAccountSetup.js';
import { useSetupWallet } from '../hooks/useSetupWallet.js';
import type { RuleFee } from '../lib/funding.js';
import { appRoutes } from '../lib/routes.js';
import { CreateAccount } from '../pages/CreateAccount.js';
import { AppShell } from './AppShell.js';
import { ErrorState } from './ErrorState.js';
import { RuleFundingSetup } from './RuleFundingSetup.js';
import { PageHeading } from './chrome/PageHeading.js';
import { Spinner } from './chrome/Spinner.js';

function readFundingProgress(key: string) {
  try {
    return window.localStorage.getItem(key) === 'pending';
  } catch {
    return false;
  }
}

interface GateProps {
  title: string;
  fundingFee?: RuleFee;
  children: (accounts: { agent: Address; vault: Address }) => ReactNode;
}

export function AccountSetupGate(props: GateProps) {
  return <WalletAccountSetupGate {...props} wallet={useSetupWallet()} />;
}

export function WalletAccountSetupGate({
  title,
  fundingFee,
  children,
  wallet,
  workflowScope,
  manageFunds = false,
}: GateProps & {
  wallet: SetupWallet;
  workflowScope?: string;
  manageFunds?: boolean;
}) {
  const { address, isReconnecting } = useAccount();
  const owner = isReconnecting ? undefined : (address?.toLowerCase() as Address | undefined);
  const setup = useAccountSetup({ owner, wallet, scope: workflowScope });
  const { agent, vault, linked } = setup.data ?? {};
  const navigate = useNavigate();
  const { state } = useLocation();
  const [pendingOwner, setPendingOwner] = useState<Address>();
  const workflow = workflowScope !== undefined;
  const key = `rulebook:setup-funding:v1:${owner}${workflow ? `:${workflowScope}` : ''}`;

  function recordFundingProgress(pending: boolean) {
    setPendingOwner(pending ? owner : undefined);
    try {
      if (pending) window.localStorage.setItem(key, 'pending');
      else window.localStorage.removeItem(key);
    } catch {
      // The current route can still complete setup when storage is unavailable.
    }
  }

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
              {workflow && (
                <Link to={appRoutes.accountFunds} className="app-link">
                  Manage existing vault funds
                </Link>
              )}
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
        <CreateAccount
          key={owner}
          setup={setup}
          workflow={workflow}
          onBegin={() => recordFundingProgress(true)}
        />
      </AppShell>
    );
  }

  const fundingPending = pendingOwner === owner || readFundingProgress(key);
  const fundingAgent =
    typeof state?.fundingAgent === 'string' ? state.fundingAgent.toLowerCase() : undefined;
  const requestedFee =
    !fundingAgent || fundingAgent === agent.toLowerCase() ? fundingFee : undefined;
  if ((fundingPending && !manageFunds) || requestedFee) {
    return (
      <AppShell focused>
        <RuleFundingSetup
          key={`${owner}:${requestedFee ?? 'onboarding'}`}
          agent={agent}
          vault={vault}
          workflow={workflow}
          fee={fundingPending ? undefined : requestedFee}
          onCompose={() => {
            recordFundingProgress(false);
            if (workflow) void navigate(appRoutes.newWorkflow, { replace: true });
            else
              void navigate(appRoutes.create, { state: { firstRuleGuide: true }, replace: true });
          }}
        />
      </AppShell>
    );
  }

  return children({ agent, vault });
}
