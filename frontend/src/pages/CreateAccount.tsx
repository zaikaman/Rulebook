import {
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type OnboardingStep,
} from '@rulebook/shared';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';

import { AddressLink } from '../components/AddressLink.js';
import { ErrorState } from '../components/ErrorState.js';
import { NetworkBadge } from '../components/NetworkBadge.js';
import { TxLink } from '../components/TxLink.js';
import { useAccountSetup } from '../hooks/useAccountSetup.js';
import { useSetupWallet } from '../hooks/useSetupWallet.js';
import { api } from '../lib/api.js';

const STEP_LABEL: Record<OnboardingStep['name'], string> = {
  agent: 'Automation account',
  vault: 'Funds account',
  link: 'Link the two accounts',
  fund_credit: 'Execution credit',
};

const STATUS_LABEL: Record<OnboardingStep['status'], string> = {
  skipped: 'Already done',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  failed: 'Needs a retry',
};

function StepRow({ step }: { readonly step: OnboardingStep }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-2">
      <span className="font-medium">{STEP_LABEL[step.name]}</span>
      <span className="text-xs text-ink-muted">{STATUS_LABEL[step.status]}</span>
      {step.chain_id ? <NetworkBadge chainId={step.chain_id} /> : null}
      {step.tx_hash && step.chain_id ? (
        <TxLink chainId={step.chain_id} txHash={step.tx_hash} />
      ) : null}
      {step.error ? <span className="text-xs text-cancelled">{step.error}</span> : null}
    </li>
  );
}

/** One guided flow for US1: both contracts are created, then the owner links them. */
export function CreateAccount() {
  const { address } = useAccount();
  const wallet = useSetupWallet();
  const owner = address?.toLowerCase() as Address | undefined;
  const setup = useAccountSetup({ ...(owner ? { owner } : {}), api, wallet });

  const resumeLabel =
    setup.setupState === 'none'
      ? 'Create my account'
      : setup.setupState === 'agent_only'
        ? 'Resume: create my funds account'
        : setup.setupState === 'partial'
          ? 'Resume: link my accounts'
          : 'Account ready';

  if (!address) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="text-ink-muted">
          Connect the wallet that should own your automation account and your funds account. Only
          that wallet can withdraw.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="text-ink-muted">
          Two contracts, both owned by {address.slice(0, 6)}…{address.slice(-4)}. The operator pays
          deployment and execution costs and can never withdraw your principal.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={setup.resuming || setup.setupState === 'complete'}
          onClick={() => void setup.resume().catch(() => undefined)}
          className="rounded bg-ink px-4 py-2 font-medium text-surface disabled:opacity-50"
        >
          {setup.resuming ? 'Working…' : resumeLabel}
        </button>
        {setup.setupState === 'complete' ? (
          <a href="/account" className="text-sm underline">
            View your account
          </a>
        ) : null}
      </div>

      {setup.error ? <ErrorState message={setup.error.message} /> : null}

      {setup.result ? (
        <ol className="space-y-2" aria-label="Setup steps">
          {setup.result.steps.map((step) => (
            <StepRow key={step.name} step={step} />
          ))}
        </ol>
      ) : null}

      {setup.agent ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">Automation account</span>
          <NetworkBadge chainId={LASNA_CHAIN_ID} />
          <AddressLink chainId={LASNA_CHAIN_ID} address={setup.agent} />
        </div>
      ) : null}

      {setup.vault ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">Funds account</span>
          <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
          <AddressLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} address={setup.vault} />
        </div>
      ) : null}

      {setup.vault ? (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h2 className="flex flex-wrap items-center gap-2 font-medium">
            Get test funds <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
          </h2>
          <p className="text-sm text-ink-muted">
            The sponsor sends a small, capped amount of demo USDC and WETH into your funds account.
            You can claim once per address. The sponsor signs the funding transaction.
          </p>
          <button
            type="button"
            disabled={setup.claiming}
            onClick={() => void setup.claimStarterFunds().catch(() => undefined)}
            className="rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {setup.claiming ? 'Sending…' : 'Send starter funds'}
          </button>
          {setup.starterFunds ? (
            <div className="space-y-1 text-sm">
              <p>
                Sent {formatUnits(setup.starterFunds.amount_usdc, 6)} USDC and{' '}
                {formatUnits(setup.starterFunds.amount_weth, 18)} WETH.
              </p>
              {(setup.starterFunds.tx_hashes ?? [setup.starterFunds.tx_hash]).map((hash) => (
                <TxLink
                  key={hash}
                  chainId={UNICHAIN_SEPOLIA_CHAIN_ID}
                  txHash={hash}
                  label="View funding"
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
