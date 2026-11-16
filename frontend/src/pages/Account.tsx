import {
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
import { AGENT_FACTORY_ADDRESS, DEMO_USDC, VAULT_FACTORY_ADDRESS } from '../lib/contracts.js';
import { CreateAccount } from './CreateAccount.js';

const ZERO = '0x0000000000000000000000000000000000000000';

/** Owned contracts plus the three balances, each labelled with its network and owner. */
export function Account() {
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

  const principalQuery = useReadContract({
    address: vault ?? ZERO,
    abi: vaultAbi,
    functionName: 'principalOf',
    args: [DEMO_USDC],
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(vault) },
  });
  const principal = principalQuery.data ?? 0n;

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

  if (!agent) return <CreateAccount />;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="text-sm text-ink-muted">
          Owned by {address}. Principal is yours; the sponsored figures are not.
        </p>
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
          {vault ? (
            <AddressLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} address={vault} />
          ) : (
            <span className="text-ink-muted">Not created yet — resume setup.</span>
          )}
        </div>
      </div>

      <BalanceTrio
        principal={`${formatUnits(principal, 6)} USDC`}
        executionCost={`${formatEther(fundsBalance.data?.value ?? 0n)} ETH`}
        watchingCredit={`${formatEther(agentBalance.data?.value ?? 0n)} REACT`}
      />

      {vault ? (
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
