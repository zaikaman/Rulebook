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

import { AddressLink } from '../components/AddressLink.js';
import { BalanceTrio } from '../components/BalanceTrio.js';
import { NetworkBadge } from '../components/NetworkBadge.js';
import { WithdrawForm } from '../components/WithdrawForm.js';
import {
  AGENT_FACTORY_ADDRESS,
  DEMO_USDC,
  LASNA_CONFIG,
  UNICHAIN_CONFIG,
  VAULT_FACTORY_ADDRESS,
} from '../lib/contracts.js';
import { CreateAccount } from './CreateAccount.js';

const ZERO = '0x0000000000000000000000000000000000000000';

function balancePlaceholder(failed: boolean): string {
  return failed ? 'Unavailable' : 'Loading…';
}

/** Owned contracts plus the three balances, each labelled with its network and owner. */
export function Account() {
  return (
    <div className="space-y-8">
      <AccountContent />
      <section className="space-y-3 border-t border-border pt-5" aria-labelledby="account-networks">
        <h2 id="account-networks" className="text-base font-semibold">
          Why two networks?
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Rules live on {LASNA_CONFIG.name} so they can watch for events, while your funds stay in
          your own vault on {UNICHAIN_CONFIG.name}, where trades and withdrawals settle.
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {[LASNA_CONFIG, UNICHAIN_CONFIG].map((network) => (
            <li key={network.chainId}>
              <a
                href={network.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="text-ink underline underline-offset-4"
              >
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
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="text-ink-muted">Connect a wallet to see your accounts and balances.</p>
      </section>
    );
  }

  if (agentQuery.isLoading || vaultQuery.isLoading || linkedVault.isLoading) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Looking up your accounts…
      </p>
    );
  }
  if (!agent || !vault) return <CreateAccount />;
  const needsLink = linkedVault.isSuccess && linkedVault.data.toLowerCase() !== vault.toLowerCase();

  return (
    <section className="space-y-6">
      {needsLink ? (
        <CreateAccount />
      ) : (
        <>
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">Your account</h1>
            <p className="text-sm text-ink-muted">Owned by {address}.</p>
          </header>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-4 text-sm">
              <span className="font-medium">Automation account</span>
              <NetworkBadge chainId={LASNA_CHAIN_ID} />
              <AddressLink chainId={LASNA_CHAIN_ID} address={agent} />
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-4 text-sm">
              <span className="font-medium">Funds account</span>
              <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
              <AddressLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} address={vault} />
            </div>
          </div>
        </>
      )}

      <BalanceTrio
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
