import type { Address } from '@rulebook/shared';
import { formatEther, formatUnits } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { UNICHAIN_SEPOLIA_CHAIN_ID, vaultAbi } from '@rulebook/shared';

import { AccountFunding, useExecutionCredit } from '../components/AccountFunding.js';
import { BalanceTrio } from '../components/BalanceTrio.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { WithdrawForm } from '../components/WithdrawForm.js';
import { useAccountSetup } from '../hooks/useAccountSetup.js';
import { useSetupWallet } from '../hooks/useSetupWallet.js';
import { DEMO_USDC, LASNA_CONFIG, UNICHAIN_CONFIG } from '../lib/contracts.js';
import { shortAddress } from '../lib/listings.js';
import { CreateAccount } from './CreateAccount.js';

function displayBalance(
  value: bigint | undefined,
  format: (value: bigint) => string,
  failed: boolean,
) {
  return value !== undefined ? format(value) : failed ? 'Unavailable' : 'Loading…';
}

function FundedAccount({ agent, vault }: { agent: Address; vault: Address }) {
  const principal = useReadContract({
    address: vault,
    abi: vaultAbi,
    functionName: 'principalOf',
    args: [DEMO_USDC],
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
  });
  const { execution, watching } = useExecutionCredit(agent, vault);
  const refreshBalances = () =>
    void Promise.all([principal.refetch(), execution.refetch(), watching.refetch()]);

  return (
    <>
      <BalanceTrio
        accounts={{ agent, vault }}
        principal={displayBalance(
          principal.data,
          (value) => `${formatUnits(value, 6)} USDC`,
          principal.isError,
        )}
        executionCost={displayBalance(
          execution.data,
          (value) => `${formatEther(value)} ETH`,
          execution.isError,
        )}
        watchingCredit={displayBalance(
          watching.data,
          (value) => `${formatEther(value)} REACT`,
          watching.isError,
        )}
      />
      <AccountFunding agent={agent} vault={vault} onConfirmed={refreshBalances} />
      {(principal.isError || execution.isError || watching.isError) && (
        <ErrorState message="Some balances could not be loaded." onRetry={refreshBalances} />
      )}
      {principal.data !== undefined && (
        <WithdrawForm
          vault={vault}
          token={DEMO_USDC}
          tokenSymbol="USDC"
          tokenDecimals={6}
          principal={principal.data}
          onConfirmed={() => void principal.refetch()}
        />
      )}
    </>
  );
}

export function Account() {
  const { address } = useAccount();
  const owner = address?.toLowerCase() as Address | undefined;
  const setup = useAccountSetup({ owner, wallet: useSetupWallet() });
  const { agent, vault, linked } = setup.data ?? {};

  return (
    <section className="app-page">
      <PageHeading
        title="Your account"
        description="Manage your vault funds and the network fees for your rules."
        aside={
          address && (
            <span className="app-tag" title={address}>
              Owner <code>{shortAddress(address)}</code>
            </span>
          )
        }
      />
      {agent && vault && linked ? (
        <FundedAccount agent={agent} vault={vault} />
      ) : setup.isLoading ? (
        <div className="app-skeleton h-36 animate-pulse" role="status">
          <span className="sr-only">Looking up your accounts…</span>
        </div>
      ) : setup.error ? (
        <ErrorState
          message="Your accounts could not be loaded."
          detail={setup.error.message}
          onRetry={() => void setup.refetch()}
        />
      ) : (
        <CreateAccount setup={setup} />
      )}
      <section className="app-divider space-y-3 pt-5" aria-labelledby="account-networks">
        <h2 id="account-networks" className="app-panel-heading">
          Why two networks?
        </h2>
        <p className="app-copy">
          Reactive Lasna watches for rule triggers. Your vault on Unichain Sepolia carries out
          trades and withdrawals.
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
    </section>
  );
}
