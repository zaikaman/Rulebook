import { FlashIcon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type OnboardingStep,
} from '@rulebook/shared';
import { useState } from 'react';
import { BaseError, formatUnits } from 'viem';
import { useAccount } from 'wagmi';

import { AddressLink } from '../components/AddressLink.js';
import { EmptyState } from '../components/chrome/EmptyState.js';
import { PageHeading } from '../components/chrome/PageHeading.js';
import { ErrorState } from '../components/ErrorState.js';
import { NetworkBadge } from '../components/NetworkBadge.js';
import { TxLink } from '../components/TxLink.js';
import { useAccountSetup } from '../hooks/useAccountSetup.js';
import { useSetupWallet } from '../hooks/useSetupWallet.js';
import { api } from '../lib/api.js';
import { MIRROR_ENABLED } from '../lib/contracts.js';
import { WalletAuthorizationError } from '../lib/errors.js';

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
    <li className="app-panel-pad flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{STEP_LABEL[step.name]}</span>
      <span
        className="app-tag"
        data-tone={
          step.status === 'confirmed'
            ? 'positive'
            : step.status === 'failed'
              ? 'warning'
              : undefined
        }
      >
        {STATUS_LABEL[step.status]}
      </span>
      {step.chain_id ? <NetworkBadge chainId={step.chain_id} /> : null}
      {step.tx_hash && step.chain_id ? (
        <TxLink chainId={step.chain_id} txHash={step.tx_hash} />
      ) : null}
      {step.error ? (
        <span className="basis-full break-words text-xs text-silent">{step.error}</span>
      ) : null}
    </li>
  );
}

/** One guided flow for US1: both contracts are created, then the owner links them. */
export function CreateAccount() {
  const { address } = useAccount();
  const wallet = useSetupWallet();
  const owner = address?.toLowerCase() as Address | undefined;
  const setup = useAccountSetup({ ...(owner ? { owner } : {}), api, wallet });
  const [mirrorVault, setMirrorVault] = useState(false);

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
      <section className="app-page">
        <PageHeading title="Create your account" />
        <EmptyState
          icon={Wallet01Icon}
          title="Connect the owner wallet"
          description="Connect the wallet that should own both accounts. Only that wallet can withdraw funds."
        />
      </section>
    );
  }

  return (
    <section className="app-page">
      <PageHeading
        title="Create your account"
        description={`Set up two linked contracts for ${address.slice(0, 6)}…${address.slice(-4)}. Your wallet owns both accounts.`}
      />

      <div className="app-panel">
        <div className="app-balance-grid">
          <div className="app-panel-pad space-y-3">
            <div className="app-panel-header">
              <span className="app-icon">
                <HugeiconsIcon icon={FlashIcon} size={19} aria-hidden="true" />
              </span>
              <h2 className="app-panel-heading">Automation account</h2>
            </div>
            <NetworkBadge chainId={LASNA_CHAIN_ID} />
            <p className="app-copy">
              Stores your rules and watches for the events that trigger them.
            </p>
            {setup.agent ? <AddressLink chainId={LASNA_CHAIN_ID} address={setup.agent} /> : null}
          </div>
          <div className="app-panel-pad space-y-3">
            <div className="app-panel-header">
              <span className="app-icon">
                <HugeiconsIcon icon={Wallet01Icon} size={19} aria-hidden="true" />
              </span>
              <h2 className="app-panel-heading">Funds account</h2>
            </div>
            <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
            <p className="app-copy">
              Holds your funds and settles trades and withdrawals on Unichain.
            </p>
            {setup.vault ? (
              <AddressLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} address={setup.vault} />
            ) : null}
            {MIRROR_ENABLED && !setup.vault && setup.setupState !== 'complete' ? (
              <label className="app-field">
                Vault mode
                <select
                  className="app-input"
                  value={mirrorVault ? 'mirror' : 'leader'}
                  disabled={setup.resuming}
                  onChange={(event) => setMirrorVault(event.target.value === 'mirror')}
                >
                  <option value="leader">Standard vault</option>
                  <option value="mirror">Mirror-only vault</option>
                </select>
                <span className="app-copy">Vault mode is permanent once deployed.</span>
              </label>
            ) : null}
          </div>
        </div>
        <div className="app-divider app-panel-pad flex flex-wrap items-center justify-between gap-3">
          {setup.setupState === 'complete' ? (
            <p className="app-tag" data-tone="positive" role="status">
              Account ready
            </p>
          ) : (
            <p className="app-copy">
              The operator covers contract deployment and automated execution.
            </p>
          )}
          {setup.setupState === 'complete' ? (
            <a href="/account" className="app-button app-button--primary">
              View your account
            </a>
          ) : (
            <button
              type="button"
              disabled={setup.resuming}
              onClick={() =>
                void setup.resume(mirrorVault ? 'mirror' : undefined).catch(() => undefined)
              }
              className="app-button app-button--primary"
            >
              {setup.resuming ? 'Working…' : resumeLabel}
            </button>
          )}
        </div>
      </div>

      {setup.error instanceof WalletAuthorizationError ? (
        <ErrorState
          message={`${setup.error.message} Then select “${resumeLabel}” to continue.`}
          chainId={setup.error.chainId}
        />
      ) : setup.error instanceof BaseError ? (
        <ErrorState message={setup.error.shortMessage} detail={setup.error.message} />
      ) : setup.error ? (
        <ErrorState message={setup.error.message} />
      ) : null}

      {setup.result ? (
        <ol className="app-panel app-rules-list" aria-label="Setup steps">
          {setup.result.steps.map((step) => (
            <StepRow key={step.name} step={step} />
          ))}
        </ol>
      ) : null}

      {setup.vault ? (
        <div className="app-panel app-panel-pad space-y-3">
          <h2 className="app-panel-header app-panel-heading">
            Get test funds <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
          </h2>
          <p className="app-copy">
            The sponsor sends a small, capped amount of demo USDC and WETH into your funds account.
            You can claim once per address. The sponsor signs the funding transaction.
          </p>
          <button
            type="button"
            disabled={setup.claiming}
            onClick={() => void setup.claimStarterFunds().catch(() => undefined)}
            className="app-button"
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
