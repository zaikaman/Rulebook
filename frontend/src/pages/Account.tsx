import type { Address } from '@rulebook/shared';
import { formatEther, formatUnits } from 'viem';
import { useSearchParams } from 'react-router';
import { useAccount, useReadContract } from 'wagmi';
import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID, vaultAbi } from '@rulebook/shared';

import { AccountFunding, useExecutionCredit } from '../components/AccountFunding.js';
import { AccountSetupGate } from '../components/AccountSetupGate.js';
import { BalanceTrio } from '../components/BalanceTrio.js';
import { NetworkBadge } from '../components/NetworkBadge.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { TelegramNotifications } from '../components/TelegramNotifications.js';
import { WithdrawForm } from '../components/WithdrawForm.js';
import { DEMO_USDC, LASNA_CONFIG, UNICHAIN_CONFIG } from '../lib/contracts.js';
import { shortAddress } from '../lib/listings.js';
import { AppShell } from '../components/AppShell.js';

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
  const [search] = useSearchParams();
  const fee = search.get('fund');

  return (
    <AccountSetupGate
      title="Your account"
      fundingFee={fee === 'watching' || fee === 'execution' ? fee : undefined}
    >
      {({ agent, vault }) => (
        <AppShell>
          <section className="app-page">
            <PageHeading
              title="Your account"
              description="Manage your vault funds and the network fees for your rules."
              focusOnMount={!!fee}
            />
            <div className="app-account-layout">
              <div className="app-account-main">
                <FundedAccount key={agent} agent={agent} vault={vault} />
                {address && <TelegramNotifications agent={agent} owner={address} />}
              </div>

              <aside className="app-account-rail" aria-label="Account context">
                <section
                  className="app-panel app-panel-pad app-rail-block"
                  aria-labelledby="account-context"
                >
                  <h2 id="account-context" className="app-panel-heading">
                    Account
                  </h2>
                  {address && (
                    <div className="app-rail-fact">
                      <span className="app-rail-label">Owner wallet</span>
                      <code className="app-rail-value" title={address}>
                        {shortAddress(address)}
                      </code>
                    </div>
                  )}
                  <div className="app-rail-fact">
                    <span className="app-rail-label">Networks</span>
                    <ul className="app-rail-networks">
                      <li>
                        <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
                        <span>Holds principal, execution fees, and withdrawals.</span>
                      </li>
                      <li>
                        <NetworkBadge chainId={LASNA_CHAIN_ID} />
                        <span>Watches events and pays for rule checks.</span>
                      </li>
                    </ul>
                  </div>
                  <p className="app-copy">
                    Only this wallet can withdraw principal or change a rule.
                  </p>
                  <ul className="app-rail-links">
                    {[LASNA_CONFIG, UNICHAIN_CONFIG].map((network) => (
                      <li key={network.chainId}>
                        <a
                          href={network.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="app-link"
                        >
                          {network.name} explorer
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              </aside>
            </div>
          </section>
        </AppShell>
      )}
    </AccountSetupGate>
  );
}
