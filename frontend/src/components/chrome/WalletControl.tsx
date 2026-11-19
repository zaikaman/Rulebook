import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  Copy01Icon,
  Logout03Icon,
  Tick02Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { CHAIN_CONFIGS, type Address } from '@rulebook/shared';
import { useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';

import { isWalletRejection } from '@/lib/errors';

function subscribeToBrowserWallet(onChange: () => void) {
  window.addEventListener('ethereum#initialized', onChange);
  return () => window.removeEventListener('ethereum#initialized', onChange);
}

function hasBrowserWallet() {
  return 'ethereum' in window && Boolean(window.ethereum);
}

function walletAvatar(address: Address): CSSProperties {
  const hue = 215 + (Number.parseInt(address.slice(2, 10), 16) % 100);

  return {
    background: `radial-gradient(ellipse at 20% 15%, oklch(0.9 0.1 ${hue + 55}), transparent 68%),
      linear-gradient(145deg, oklch(0.73 0.16 ${hue}), oklch(0.49 0.19 ${hue + 24}))`,
  };
}

export function WalletControl({ setup = false }: { setup?: boolean }) {
  const { address, chainId, connector } = useAccount();
  const connection = useConnect();
  const disconnection = useDisconnect();
  const network = useSwitchChain();
  const hasInjectedProvider = useSyncExternalStore(subscribeToBrowserWallet, hasBrowserWallet);
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [copyResult, setCopyResult] = useState<'copied' | 'failed'>();

  const hasNamedWallet = connection.connectors.some(
    (candidate) => candidate.type === 'injected' && candidate.id !== 'injected',
  );
  const wallets = connection.connectors.filter(
    (candidate) => candidate.id !== 'injected' || (hasInjectedProvider && !hasNamedWallet),
  );
  const [onlyWallet] = wallets;
  const quickConnect = !address && wallets.length === 1 && onlyWallet?.id === 'injected';
  const connecting = connection.isPending;
  const chain = chainId === undefined ? undefined : CHAIN_CONFIGS.get(chainId);
  const networkLabel = chain?.name ?? (chainId === undefined ? 'Network unknown' : 'Wrong network');
  const networkTone = chain?.role ?? 'warning';
  const shortAddress = address && `${address.slice(0, 6)}…${address.slice(-4)}`;

  function closePanel() {
    panel.current?.hidePopover();
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyResult('copied');
    } catch {
      setCopyResult('failed');
    }
  }

  const connectionError =
    connection.error &&
    (isWalletRejection(connection.error)
      ? 'Connection declined. Try again when you’re ready.'
      : 'Couldn’t connect. Unlock your wallet and try again.');

  return (
    <div className={setup ? 'wallet-control account-setup__connect' : 'wallet-control'}>
      <button
        type="button"
        className={
          setup && !address
            ? 'app-button app-button--primary'
            : `wallet-trigger${address ? '' : ' wallet-trigger--connect'}`
        }
        aria-haspopup={quickConnect ? undefined : 'dialog'}
        popoverTarget={quickConnect ? undefined : panelId}
        disabled={!address && connecting}
        onClick={
          quickConnect
            ? (event) => {
                event.preventDefault();
                connection.connect({ connector: onlyWallet });
              }
            : undefined
        }
      >
        {address ? (
          <>
            <span className="wallet-avatar" style={walletAvatar(address)} aria-hidden="true" />
            <span className="wallet-identity">
              <span className="sr-only">Wallet</span>
              <span className="wallet-address">{shortAddress}</span>
              <span className="wallet-network" data-tone={networkTone}>
                <span className="wallet-dot" aria-hidden="true" />
                {networkLabel}
              </span>
            </span>
          </>
        ) : (
          <>
            <HugeiconsIcon icon={Wallet01Icon} size={18} aria-hidden="true" />
            <span>
              {connecting ? 'Connecting…' : setup ? 'Connect wallet to start' : 'Connect wallet'}
            </span>
          </>
        )}
        {!quickConnect && <HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden="true" />}
      </button>

      {quickConnect && connectionError && (
        <p className="wallet-feedback" role="alert">
          {connectionError}
        </p>
      )}

      <div
        ref={panel}
        id={panelId}
        className="wallet-popover"
        popover="auto"
        role="dialog"
        aria-label={address ? 'Wallet details' : 'Connect wallet'}
        onToggle={(event) => {
          if (event.newState === 'closed') setCopyResult(undefined);
        }}
      >
        {address ? (
          <>
            <div className="wallet-popover-header">
              <span className="wallet-avatar" style={walletAvatar(address)} aria-hidden="true" />
              <p className="wallet-popover-title">
                {connector?.id === 'injected' ? 'Browser wallet' : (connector?.name ?? 'Wallet')}
              </p>
              <p className="wallet-full-address">
                {address.slice(0, 22)}
                <wbr />
                {address.slice(22)}
              </p>
            </div>

            <div className="wallet-popover-section">
              <p className="wallet-section-label">Network</p>
              {!chain && (
                <p className="wallet-network wallet-network--notice" data-tone="warning">
                  <span className="wallet-dot" aria-hidden="true" />
                  {chainId === undefined ? networkLabel : `Unsupported network (${chainId})`}
                </p>
              )}
              {network.chains.map((candidate) => {
                const current = chainId === candidate.id;
                const switching = network.isPending && network.variables?.chainId === candidate.id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className="wallet-option"
                    aria-current={current || undefined}
                    aria-disabled={current || network.isPending || undefined}
                    onClick={() => {
                      if (!current && !network.isPending)
                        network.switchChain({ chainId: candidate.id, connector });
                    }}
                  >
                    <span
                      className="wallet-dot"
                      data-tone={CHAIN_CONFIGS.get(candidate.id)?.role}
                      aria-hidden="true"
                    />
                    <span>{switching ? `Switching to ${candidate.name}…` : candidate.name}</span>
                    {current && <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden="true" />}
                  </button>
                );
              })}
              {network.error && (
                <p className="wallet-feedback" role="alert">
                  {isWalletRejection(network.error)
                    ? 'Network switch declined.'
                    : 'Switch networks in your wallet, then try again.'}
                </p>
              )}
            </div>

            <div className="wallet-popover-section">
              <button type="button" className="wallet-option" onClick={() => void copyAddress()}>
                <HugeiconsIcon
                  icon={copyResult === 'copied' ? Tick02Icon : Copy01Icon}
                  size={16}
                  aria-hidden="true"
                />
                <span>{copyResult === 'copied' ? 'Address copied' : 'Copy address'}</span>
              </button>
              <span className="sr-only" role="status">
                {copyResult === 'copied' ? 'Address copied' : ''}
              </span>
              {copyResult === 'failed' && (
                <p className="wallet-feedback" role="alert">
                  Select and copy the address above.
                </p>
              )}
              <button
                type="button"
                className="wallet-option wallet-option--disconnect"
                disabled={disconnection.isPending || network.isPending}
                onClick={() => disconnection.disconnect({ connector }, { onSuccess: closePanel })}
              >
                <HugeiconsIcon icon={Logout03Icon} size={16} aria-hidden="true" />
                <span>{disconnection.isPending ? 'Disconnecting…' : 'Disconnect'}</span>
              </button>
              {disconnection.error && (
                <p className="wallet-feedback" role="alert">
                  Couldn’t disconnect. Try again.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="wallet-popover-section">
            <p className="wallet-section-label">Connect wallet</p>
            {wallets.map((candidate) => (
              <button
                key={candidate.uid}
                type="button"
                className="wallet-option"
                aria-disabled={connecting || undefined}
                onClick={() => {
                  if (!connecting)
                    connection.connect({ connector: candidate }, { onSuccess: closePanel });
                }}
              >
                <HugeiconsIcon icon={Wallet01Icon} size={16} aria-hidden="true" />
                <span>{candidate.id === 'injected' ? 'Browser wallet' : candidate.name}</span>
              </button>
            ))}
            {wallets.length === 0 && (
              <p className="wallet-help">
                Open this site in a wallet browser or install a browser wallet.
              </p>
            )}
            {!hasNamedWallet && !hasInjectedProvider && (
              <a
                className="wallet-option"
                href="https://rainbow.me/download"
                target="_blank"
                rel="noreferrer"
              >
                <HugeiconsIcon icon={Wallet01Icon} size={16} aria-hidden="true" />
                <span>Get Rainbow</span>
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} aria-hidden="true" />
              </a>
            )}
            {connecting && (
              <p className="wallet-help" role="status">
                Confirm the connection in your wallet.
              </p>
            )}
            {connectionError && (
              <p className="wallet-feedback" role="alert">
                {connectionError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
