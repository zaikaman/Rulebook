import { Wallet01Icon } from '@hugeicons/core-free-icons';
import {
  agentAbi,
  agentFactoryAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  vaultFactoryAbi,
  type Address,
} from '@rulebook/shared';
import { formatEther, formatUnits } from 'viem';
import { useAccount, useBalance, useReadContract } from 'wagmi';

import { BalanceTrio } from '../components/BalanceTrio.js';
import { EmptyState } from '../components/chrome/EmptyState.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { WithdrawForm } from '../components/WithdrawForm.js';
import {
  AGENT_FACTORY_ADDRESS,
  DEMO_USDC,
  LASNA_CONFIG,
  UNICHAIN_CONFIG,
  VAULT_FACTORY_ADDRESS,
} from '../lib/contracts.js';
import { shortAddress } from '../lib/listings.js';
import { CreateAccount } from './CreateAccount.js';

const ZERO = '0x0000000000000000000000000000000000000000';

function balancePlaceholder(failed: boolean): string {
  return failed ? 'Unavailable' : 'Loading…';
}

/** Owned contracts plus the three balances, each labelled with its network and owner. */
export function Account() {
  return (
    <div className="app-page">
      <AccountContent />
      <section className="app-divider space-y-3 pt-5" aria-labelledby="account-networks">
        <h2 id="account-networks" className="app-panel-heading">
          Why two networks?
        </h2>
        <p className="app-copy">
          Rules live on {LASNA_CONFIG.name} so they can watch for events, while your funds stay in
          your own vault on {UNICHAIN_CONFIG.name}, where trades and withdrawals settle.
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {[LASNA_CONFIG, UNICHAIN_CONFIG].map((network) => (
            <li key={network.chainId}>
              <a href={network.explorerUrl} target="_blank" rel="noreferrer" className="app-link">
                {network.name} explorer
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AccountContent() {
  const { address } = useAccount();
  const owner = (address?.toLowerCase() as Address | undefined) ?? ZERO;

  const agentQuery = useReadContract({
    address: AGENT_FACTORY_ADDRESS ?? ZERO,
    abi: agentFactoryAbi,
    functionName: 'agentOf',
    args: [owner],
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(address && AGENT_FACTORY_ADDRESS) },
  });
  const agent = agentQuery.data && agentQuery.data !== ZERO ? agentQuery.data : null;

  const vaultQuery = useReadContract({
    address: VAULT_FACTORY_ADDRESS ?? ZERO,
    abi: vaultFactoryAbi,
    functionName: 'vaultOf',
    args: [owner],
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(address && VAULT_FACTORY_ADDRESS) },
  });
  const vault = vaultQuery.data && vaultQuery.data !== ZERO ? vaultQuery.data : null;

  const linkedVault = useReadContract({
    address: agent ?? ZERO,
    abi: agentAbi,
    functionName: 'getVault',
    args: [BigInt(UNICHAIN_SEPOLIA_CHAIN_ID)],
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(agent && vault) },
  });

  const principalQuery = useReadContract({
    address: vault ?? ZERO,
    abi: vaultAbi,
    functionName: 'principalOf',
    args: [DEMO_USDC],
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(vault) },
  });
  const principal = principalQuery.data;

  const fundsBalance = useBalance({
    address: vault ?? ZERO,
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(vault) },
  });
  const agentBalance = useBalance({
    address: agent ?? ZERO,
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(agent) },
  });

  if (!address) {
    return (
      <section className="app-page">
        <PageHeading
          title="Your account"
          description="View the automation account and vault owned by your wallet."
        />
        <EmptyState
          icon={Wallet01Icon}
          title="Connect a wallet"
          description="Use Connect wallet in the navigation to see your accounts and balances."
        />
      </section>
    );
  }

  if (agentQuery.isLoading || vaultQuery.isLoading || linkedVault.isLoading) {
    return (
      <section className="app-page" aria-busy="true">
        <PageHeading title="Your account" />
        <p role="status" className="sr-only">
          Looking up your accounts…
        </p>
        <div className="app-skeleton h-36 animate-pulse" />
      </section>
    );
  }
  const lookupError = (!agent && agentQuery.error) || (!vault && vaultQuery.error);
  if (lookupError) {
    return (
      <section className="app-page">
        <PageHeading title="Your account" />
        <ErrorState message="Your accounts could not be loaded." detail={lookupError.message} />
      </section>
    );
  }
  if (!agent || !vault) return <CreateAccount />;
  const needsLink = linkedVault.isSuccess && linkedVault.data.toLowerCase() !== vault.toLowerCase();

  return (
    <section className="app-page">
      {needsLink ? (
        <CreateAccount />
      ) : (
        <PageHeading
          title="Your account"
          description="Manage your vault and the credits that keep your automations running."
          aside={
            <span className="app-tag" title={address}>
              Owner <code>{shortAddress(address)}</code>
            </span>
          }
        />
      )}

      <BalanceTrio
        accounts={{ agent, vault }}
        principal={
          principal === undefined
            ? balancePlaceholder(principalQuery.isError)
            : `${formatUnits(principal, 6)} USDC`
        }
        executionCost={
          fundsBalance.data
            ? `${formatEther(fundsBalance.data.value)} ETH`
            : balancePlaceholder(fundsBalance.isError)
        }
        watchingCredit={
          agentBalance.data
            ? `${formatEther(agentBalance.data.value)} REACT`
            : balancePlaceholder(agentBalance.isError)
        }
      />

      {linkedVault.error ? (
        <ErrorState
          message="The link between your accounts could not be verified."
          detail={linkedVault.error.message}
          chainId={LASNA_CHAIN_ID}
        />
      ) : null}

      {principal !== undefined ? (
        <WithdrawForm
          vault={vault}
          token={DEMO_USDC}
          tokenSymbol="USDC"
          tokenDecimals={6}
          principal={principal}
          onConfirmed={() => void principalQuery.refetch()}
        />
      ) : null}
    </section>
  );
}
