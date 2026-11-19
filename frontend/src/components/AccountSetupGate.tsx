import type { Address } from '@rulebook/shared';
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAccount } from 'wagmi';

import { useAccountSetup } from '../hooks/useAccountSetup.js';
import { useSetupWallet } from '../hooks/useSetupWallet.js';
import type { RuleFee } from '../lib/funding.js';
import { appRoutes } from '../lib/routes.js';
import { CreateAccount } from '../pages/CreateAccount.js';
import { AppShell } from './AppShell.js';
import { RuleFundingSetup } from './RuleFundingSetup.js';

function readFundingProgress(key: string) {
  try {
    return window.localStorage.getItem(key) === 'pending';
  } catch {
    return false;
  }
}

export function AccountSetupGate({
  fundingFee,
  children,
}: {
  fundingFee?: RuleFee;
  children: (accounts: { agent: Address; vault: Address }) => ReactNode;
}) {
  const { address } = useAccount();
  const owner = address?.toLowerCase() as Address | undefined;
  const setup = useAccountSetup({ owner, wallet: useSetupWallet() });
  const { agent, vault, linked } = setup.data ?? {};
  const navigate = useNavigate();
  const { state } = useLocation();
  const [pendingOwner, setPendingOwner] = useState<Address>();
  const key = `rulebook:setup-funding:v1:${owner}`;

  function recordFundingProgress(pending: boolean) {
    setPendingOwner(pending ? owner : undefined);
    try {
      if (pending) window.localStorage.setItem(key, 'pending');
      else window.localStorage.removeItem(key);
    } catch {
      // The current route can still complete setup when storage is unavailable.
    }
  }

  if (!owner || !agent || !vault || !linked) {
    return (
      <AppShell focused>
        <CreateAccount key={owner} setup={setup} onBegin={() => recordFundingProgress(true)} />
      </AppShell>
    );
  }

  const fundingPending = pendingOwner === owner || readFundingProgress(key);
  const fundingAgent =
    typeof state?.fundingAgent === 'string' ? state.fundingAgent.toLowerCase() : undefined;
  const requestedFee =
    !fundingAgent || fundingAgent === agent.toLowerCase() ? fundingFee : undefined;
  if (fundingPending || requestedFee) {
    return (
      <AppShell focused>
        <RuleFundingSetup
          key={`${owner}:${requestedFee ?? 'onboarding'}`}
          agent={agent}
          vault={vault}
          fee={fundingPending ? undefined : requestedFee}
          onCompose={() => {
            recordFundingProgress(false);
            void navigate(appRoutes.create, { state: { firstRuleGuide: true }, replace: true });
          }}
        />
      </AppShell>
    );
  }

  return children({ agent, vault });
}
