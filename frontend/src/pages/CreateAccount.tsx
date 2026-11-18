import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { useState } from 'react';
import { BaseError } from 'viem';
import { useAccount, useBalance, useConnect } from 'wagmi';

import { TestnetFaucets } from '../components/AccountFunding.js';
import { ErrorState } from '../components/ErrorState.js';
import type { useAccountSetup } from '../hooks/useAccountSetup.js';
import { AGENT_FACTORY_ADDRESS, MIRROR_ENABLED, VAULT_FACTORY_ADDRESS } from '../lib/contracts.js';
import { WalletAuthorizationError } from '../lib/errors.js';

export function CreateAccount({ setup }: { setup: ReturnType<typeof useAccountSetup> }) {
  const { address } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const connector = connectors.find((candidate) => candidate.id === 'injected') ?? connectors[0];
  const [mirrorVault, setMirrorVault] = useState(false);
  const configured = !!AGENT_FACTORY_ADDRESS && !!VAULT_FACTORY_ADDRESS;
  const error = setup.setupError;
  const lasnaBalance = useBalance({ address, chainId: LASNA_CHAIN_ID });
  const unichainBalance = useBalance({ address, chainId: UNICHAIN_SEPOLIA_CHAIN_ID });
  const needsReact = lasnaBalance.data?.value === 0n;
  const needsEth = !setup.data?.vault && unichainBalance.data?.value === 0n;
  const actionLabel = setup.data?.agent ? 'Continue account setup' : 'Create my account';

  return (
    <div className="grid gap-4">
      <section className="app-panel app-panel-pad">
        <TestnetFaucets />
      </section>
      <section className="app-panel app-panel-pad space-y-3">
        <h2 className="app-panel-heading">Set up your account</h2>
        <p className="app-copy">
          Your wallet creates and links an automation account on Lasna and a vault on Unichain
          Sepolia. Keep test REACT and ETH in your wallet to pay for setup.
        </p>
        {MIRROR_ENABLED && address && !setup.data?.vault && (
          <label className="app-field max-w-xs">
            Vault mode
            <select
              className="app-input"
              value={mirrorVault ? 'mirror' : 'standard'}
              disabled={setup.resuming}
              onChange={(event) => setMirrorVault(event.target.value === 'mirror')}
            >
              <option value="standard">Standard vault</option>
              <option value="mirror">Mirror-only vault</option>
            </select>
            <span className="app-copy">Vault mode is permanent once deployed.</span>
          </label>
        )}
        {address ? (
          <button
            type="button"
            className="app-button app-button--primary"
            disabled={
              !configured ||
              setup.resuming ||
              setup.isLoading ||
              setup.isError ||
              needsReact ||
              needsEth
            }
            onClick={() => setup.resume(mirrorVault ? 'mirror' : undefined)}
          >
            {setup.resuming ? 'Setting up your account…' : actionLabel}
          </button>
        ) : (
          <button
            type="button"
            className="app-button app-button--primary"
            disabled={isPending || !connector}
            onClick={() => connector && connect({ connector })}
          >
            Connect a wallet to start
          </button>
        )}
        {address && (needsReact || needsEth) && (
          <p className="app-copy">
            Get {needsReact ? 'test REACT' : ''}
            {needsReact && needsEth ? ' and ' : ''}
            {needsEth ? 'test ETH' : ''} in your wallet to continue.{' '}
            <button
              type="button"
              className="app-link"
              onClick={() => void Promise.all([lasnaBalance.refetch(), unichainBalance.refetch()])}
            >
              Check balances
            </button>
          </p>
        )}
        {!configured && (
          <p className="app-copy">Account setup is unavailable on this deployment.</p>
        )}
        {error instanceof WalletAuthorizationError ? (
          <ErrorState
            message={`${error.message} Then select “${actionLabel}” to continue.`}
            chainId={error.chainId}
          />
        ) : (
          error && (
            <ErrorState message={error instanceof BaseError ? error.shortMessage : error.message} />
          )
        )}
      </section>
    </div>
  );
}
