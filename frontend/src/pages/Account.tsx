import type { Address } from '@rulebook/shared';
import { formatEther, formatUnits, isAddress, isAddressEqual, zeroAddress } from 'viem';
import { Link, useSearchParams } from 'react-router';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { UNICHAIN_SEPOLIA_CHAIN_ID, vaultAbi, vaultFactoryAbi } from '@rulebook/shared';

import { AccountFunding, useExecutionCredit } from '../components/AccountFunding.js';
import { AccountSetupGate } from '../components/AccountSetupGate.js';
import { AddressLink } from '../components/AddressLink.js';
import { BalanceTrio } from '../components/BalanceTrio.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { TelegramNotifications } from '../components/TelegramNotifications.js';
import { WithdrawForm } from '../components/WithdrawForm.js';
import {
  DEMO_USDC,
  DEMO_WETH,
  LASNA_CONFIG,
  PREVIOUS_VAULT_FACTORY_ADDRESSES,
  UNICHAIN_CONFIG,
  VAULT_FACTORY_ADDRESS,
} from '../lib/contracts.js';
import { shortAddress } from '../lib/listings.js';
import { appRoutes } from '../lib/routes.js';
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

function PreviousVault({ vault, address }: { vault: Address; address: Address }) {
  const contract = { address: vault, abi: vaultAbi, chainId: UNICHAIN_SEPOLIA_CHAIN_ID } as const;
  const owner = useReadContract({ ...contract, functionName: 'owner' });
  const canWithdraw = Boolean(address && owner.data && isAddressEqual(address, owner.data));
  const usdc = useReadContract({
    ...contract,
    functionName: 'principalOf',
    args: [DEMO_USDC],
    query: { enabled: canWithdraw },
  });
  const weth = useReadContract({
    ...contract,
    functionName: 'principalOf',
    args: [DEMO_WETH],
    query: { enabled: canWithdraw },
  });

  return (
    <AppShell>
      <section className="app-page">
        <PageHeading title="Withdraw from a previous vault" />
        <AddressLink address={vault} chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
        {owner.isPending ? (
          <p role="status" className="app-copy">
            Checking vault ownership…
          </p>
        ) : owner.isError ? (
          <ErrorState
            message="Vault ownership could not be verified."
            onRetry={() => void owner.refetch()}
          />
        ) : !canWithdraw ? (
          <ErrorState message="Connect the wallet that owns this vault to withdraw." />
        ) : null}
        {canWithdraw && (usdc.isError || weth.isError) && (
          <ErrorState
            message="Some vault balances could not be checked."
            onRetry={() => void Promise.all([usdc.refetch(), weth.refetch()])}
          />
        )}
        {canWithdraw &&
          usdc.data !== undefined &&
          weth.data !== undefined &&
          usdc.data === 0n &&
          weth.data === 0n && (
            <p className="app-copy">This vault has no deposited USDC or WETH to withdraw.</p>
          )}
        {canWithdraw && usdc.data !== undefined && usdc.data > 0n && (
          <WithdrawForm
            vault={vault}
            token={DEMO_USDC}
            tokenSymbol="USDC"
            tokenDecimals={6}
            principal={usdc.data}
            onConfirmed={() => void usdc.refetch()}
          />
        )}
        {canWithdraw && weth.data !== undefined && weth.data > 0n && (
          <WithdrawForm
            vault={vault}
            token={DEMO_WETH}
            tokenSymbol="WETH"
            tokenDecimals={18}
            principal={weth.data}
            onConfirmed={() => void weth.refetch()}
          />
        )}
        <Link to={appRoutes.account} className="app-link">
          Back to your account
        </Link>
      </section>
    </AppShell>
  );
}

function usePreviousVaults(address?: Address) {
  const factories = PREVIOUS_VAULT_FACTORY_ADDRESSES.length
    ? PREVIOUS_VAULT_FACTORY_ADDRESSES
    : VAULT_FACTORY_ADDRESS
      ? [VAULT_FACTORY_ADDRESS]
      : [];
  const query = useReadContracts({
    contracts: factories.map(
      (factory) =>
        ({
          address: factory,
          abi: vaultFactoryAbi,
          functionName: 'vaultOf',
          chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
          args: [address ?? zeroAddress],
        }) as const,
    ),
    query: { enabled: !!address && factories.length > 0 },
  });
  const vaults = [
    ...new Set(
      query.data?.flatMap((entry) =>
        entry.status === 'success' && entry.result !== zeroAddress ? [entry.result] : [],
      ),
    ),
  ];
  return { vaults, query };
}

export function Account() {
  const { address } = useAccount();
  const [search] = useSearchParams();
  const fee = search.get('fund');
  const previousVault = search.get('vault');
  const { vaults: previousVaults, query: previous } = usePreviousVaults(address);

  if (previousVault && isAddress(previousVault)) {
    if (address && previousVaults.some((vault) => isAddressEqual(vault, previousVault))) {
      return <PreviousVault key={previousVault} vault={previousVault} address={address} />;
    }
    return (
      <AppShell>
        <section className="app-page">
          <PageHeading title="Withdraw from a previous vault" />
          {!address ? (
            <p className="app-copy">Connect the wallet that owns this vault.</p>
          ) : previous.isLoading ? (
            <p role="status" className="app-copy">
              Checking your previous vault…
            </p>
          ) : (
            <ErrorState
              message="This vault could not be verified for the connected wallet."
              {...(previous.isError || previous.data?.some((entry) => entry.status === 'failure')
                ? { onRetry: () => void previous.refetch() }
                : {})}
            />
          )}
          <Link to={appRoutes.account} className="app-link">
            Back to your account
          </Link>
        </section>
      </AppShell>
    );
  }

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
              aside={
                address && (
                  <span className="app-tag" title={address}>
                    Owner <code>{shortAddress(address)}</code>
                  </span>
                )
              }
            />
            <FundedAccount key={agent} agent={agent} vault={vault} />
            {address && <TelegramNotifications agent={agent} owner={address} />}
            {previousVaults
              .filter((previous) => !isAddressEqual(previous, vault))
              .map((previous) => (
                <Link
                  key={previous}
                  to={`${appRoutes.account}?vault=${previous}`}
                  className="app-link"
                >
                  Withdraw from vault {shortAddress(previous)}
                </Link>
              ))}
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
          </section>
        </AppShell>
      )}
    </AccountSetupGate>
  );
}
