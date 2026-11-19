import {
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  CircleArrowReload01Icon,
  Copy01Icon,
  Tick02Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  LASNA_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  BaseError,
  erc20Abi,
  formatUnits,
  InsufficientFundsError,
  InvalidParamsRpcError,
  numberToHex,
  zeroAddress,
  type EIP1193Provider,
  type WalletPermission,
} from 'viem';
import { useAccount, useBalance, useConfig, useReadContract } from 'wagmi';
import { getAccount } from 'wagmi/actions';

import { WalletControl } from '../components/chrome/WalletControl.js';
import { AccountSetupFrame } from '../components/AccountSetupFrame.js';
import { ErrorState } from '../components/ErrorState.js';
import { TxLink } from '../components/TxLink.js';
import {
  remainingSetupSteps,
  type SetupStep,
  type useAccountSetup,
} from '../hooks/useAccountSetup.js';
import {
  AGENT_FACTORY_ADDRESS,
  DEMO_USDC,
  MIRROR_ENABLED,
  VAULT_FACTORY_ADDRESS,
} from '../lib/contracts.js';
import {
  isWalletRejection,
  SetupTransactionError,
  WalletAuthorizationError,
} from '../lib/errors.js';
import { shortAddress } from '../lib/listings.js';
import { estimateLasnaSetupFee, estimateUnichainSetupFee, roundUpFee } from '../lib/setupFees.js';
import {
  allowSetupNetwork,
  checkSetupNetworks,
  isUnsupportedWalletMethod,
  permittedSetupChains,
} from '../lib/setupNetworks.js';
import { testnetTokens } from '../lib/testnetTokens.js';
import { lasnaChain, unichainSepoliaChain } from '../lib/wagmi.js';

type Balance = { value?: bigint; decimals: number; failed: boolean };
type Token = (typeof testnetTokens)[keyof typeof testnetTokens];

const setupStages = {
  wallet: {
    number: 1,
    title: 'Connect your wallet',
    description: 'Use your wallet to create a Rulebook automation account and vault.',
  },
  networks: {
    number: 2,
    title: 'Set up test networks',
    description: 'Rulebook uses Reactive Lasna for automation and Unichain Sepolia for your vault.',
  },
  tokens: {
    number: 3,
    title: 'Get test tokens',
    description: 'Your wallet uses test tokens to pay the network fees for setup.',
  },
  create: {
    number: 4,
    title: 'Create your account',
    description: 'Review what Rulebook will set up, then approve the requests in your wallet.',
  },
};

function needsTopUp(value: bigint | undefined, minimum?: bigint) {
  return value !== undefined && (value === 0n || (minimum !== undefined && value < minimum));
}

function TokenRow({
  token,
  purpose,
  required,
  connected,
  balance,
  minimum,
  estimating = false,
}: {
  token: Token;
  purpose: string;
  required: boolean;
  connected: boolean;
  balance: Balance;
  minimum?: bigint;
  estimating?: boolean;
}) {
  const short = required && needsTopUp(balance.value, minimum);
  let status = required ? 'Required for setup' : 'For later';
  let tone = 'neutral';
  if (connected && balance.failed) {
    status = 'Balance unavailable';
    tone = 'warning';
  } else if (connected && balance.value === undefined) {
    status = 'Checking balance…';
  } else if (connected && short) {
    status = balance.value === 0n ? 'Missing' : 'Top up recommended';
    tone = 'warning';
  } else if (connected && balance.value !== undefined && balance.value > 0n) {
    status = required && minimum !== undefined ? 'Covers estimate' : 'In your wallet';
    tone = !required || minimum !== undefined ? 'positive' : 'neutral';
  }

  return (
    <li className="account-setup__token" data-network={token.network.role}>
      <div className="account-setup__token-name">
        <span className="account-setup__network-dot" aria-hidden="true" />
        <div>
          <h3>Test {token.symbol}</h3>
          <p>{token.network.name}</p>
        </div>
      </div>
      <div className="account-setup__token-status">
        <span className="account-setup__status" data-tone={tone}>
          {tone === 'positive' && <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden="true" />}
          {status}
        </span>
        {connected && !balance.failed && balance.value !== undefined && (
          <code>
            {formatUnits(balance.value, balance.decimals)} {token.symbol}
          </code>
        )}
      </div>
      <div className="account-setup__token-help">
        <p>{purpose}</p>
        {required && minimum !== undefined && (
          <p className="account-setup__minimum">
            Estimated minimum{' '}
            <strong>
              {formatUnits(minimum, balance.decimals)} {token.symbol}
            </strong>
            {short && !balance.failed && balance.value !== undefined && balance.value > 0n && (
              <span>
                Add {formatUnits(roundUpFee(minimum - balance.value), balance.decimals)}{' '}
                {token.symbol} more
              </span>
            )}
          </p>
        )}
        {required && connected && minimum === undefined && (
          <p>{estimating ? 'Estimating setup fee…' : 'Setup fee estimate unavailable.'}</p>
        )}
        {!required && (
          <p className="account-setup__minimum">
            Required for setup <strong>0 {token.symbol}</strong>
          </p>
        )}
        <a className="app-link" href={token.faucet} target="_blank" rel="noreferrer">
          {token.linkLabel}
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {(!balance.value || short || balance.failed) && <p>{token.instructions}</p>}
      </div>
    </li>
  );
}

function FaucetAddress({ address }: { address: Address }) {
  const [copy, setCopy] = useState<'success' | 'error'>();
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopy('success');
    } catch {
      setCopy('error');
    }
  }

  return (
    <div className="account-setup__address">
      <p>
        Send to <code title={address}>{shortAddress(address)}</code>
      </p>
      <button className="app-button" type="button" onClick={() => void copyAddress()}>
        <HugeiconsIcon
          icon={copy === 'success' ? Tick02Icon : Copy01Icon}
          size={15}
          aria-hidden="true"
        />
        {copy === 'success' ? 'Address copied' : 'Copy address'}
      </button>
      <p role="status" className={copy === 'error' ? 'account-setup__address-error' : 'sr-only'}>
        {copy === 'success'
          ? 'Wallet address copied.'
          : copy === 'error'
            ? `Copy this address: ${address}`
            : ''}
      </p>
    </div>
  );
}

function SetupReview({
  steps,
  running,
  mirror,
}: {
  steps: readonly SetupStep[];
  running: boolean;
  mirror: boolean;
}) {
  const actions = {
    agent: { label: 'Create your automation account', network: testnetTokens.react.network.name },
    vault: {
      label: mirror ? 'Sign and create your mirror-only vault' : 'Sign and create your vault',
      network: testnetTokens.eth.network.name,
    },
    link: {
      label: 'Link your automation account and vault',
      network: testnetTokens.react.network.name,
    },
  };
  return (
    <section className="account-setup__review" aria-labelledby="setup-wallet-steps">
      <h2 id="setup-wallet-steps">{running ? 'Current wallet request' : 'Wallet steps'}</h2>
      <ol>
        {(running ? steps.slice(0, 1) : steps).map((step) => (
          <li key={step} aria-current={running ? 'step' : undefined}>
            <span>{actions[step].label}</span>
            <small>
              {actions[step].network}
              {step === 'vault' && ' · 2 approvals'}
            </small>
          </li>
        ))}
      </ol>
      <p id="setup-wallet-instructions" role={running ? 'status' : undefined}>
        {running
          ? 'Check your wallet for the next request. This can take a moment.'
          : 'Your wallet shows each approval and its network fee.'}
      </p>
    </section>
  );
}

export function CreateAccount({
  setup,
  onBegin,
}: {
  setup: ReturnType<typeof useAccountSetup>;
  onBegin?: () => void;
}) {
  const { address, connector, isReconnecting } = useAccount();
  const config = useConfig();
  const [mirrorOwner, setMirrorOwner] = useState<Address>();
  const [tokenReview, setTokenReview] = useState<{
    walletKey: string;
    choice: 'review' | 'continue';
  }>();
  const [networkProgress, setNetworkProgress] = useState<{
    walletKey: string;
    chains: readonly number[];
    done: boolean;
  }>();
  const walletLifetime = useRef<AbortController>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const connected = !!address;
  useEffect(() => {
    const lifetime = new AbortController();
    walletLifetime.current = lifetime;
    return () => lifetime.abort();
  }, []);

  const mirrorVault = connected && mirrorOwner === address;
  const hasAgent = !!setup.data?.agent;
  const hasVault = !!setup.data?.vault;
  const walletSteps = setup.data ? remainingSetupSteps(setup.data) : [];
  const configured = !!AGENT_FACTORY_ADDRESS && !!VAULT_FACTORY_ADDRESS;
  const query = { enabled: connected, refetchOnWindowFocus: 'always' } as const;
  const react = useBalance({ address, chainId: LASNA_CHAIN_ID, query });
  const eth = useBalance({ address, chainId: UNICHAIN_SEPOLIA_CHAIN_ID, query });
  const usdc = useReadContract({
    address: DEMO_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? zeroAddress],
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    query,
  });

  const checkingAccount = setup.isLoading || isReconnecting;
  const feeQuery = { retry: false, refetchOnWindowFocus: 'always' } as const;
  const checkReactFee = connected && configured && !!setup.data && !setup.resuming;
  const checkEthFee = connected && configured && !hasVault && !setup.resuming;
  const reactFee = useQuery({
    ...feeQuery,
    queryKey: ['lasna-setup-fee', address, hasAgent],
    queryFn: () => estimateLasnaSetupFee(address!, hasAgent),
    enabled: checkReactFee,
  });
  const ethFee = useQuery({
    ...feeQuery,
    queryKey: ['unichain-setup-fee', mirrorVault],
    queryFn: () => estimateUnichainSetupFee(mirrorVault),
    enabled: checkEthFee,
  });
  const estimatingFees = (checkReactFee && reactFee.isLoading) || (checkEthFee && ethFee.isLoading);
  const missing = [
    !react.isError && react.data?.value === 0n ? 'test REACT' : null,
    !hasVault && !eth.isError && eth.data?.value === 0n ? 'test ETH' : null,
  ].filter(Boolean);
  const topUps = [
    !react.isError && !!react.data?.value && needsTopUp(react.data.value, reactFee.data)
      ? 'test REACT'
      : null,
    !hasVault && !eth.isError && !!eth.data?.value && needsTopUp(eth.data.value, ethFee.data)
      ? 'test ETH'
      : null,
  ].filter(Boolean);
  const balanceError = react.isError || (!hasVault && eth.isError);
  const checkingBalances = react.data === undefined || (!hasVault && eth.data === undefined);
  const refreshing = react.isFetching || eth.isFetching || reactFee.isFetching || ethFee.isFetching;
  const ready =
    connected &&
    !!connector &&
    walletSteps.length > 0 &&
    configured &&
    !checkingAccount &&
    !setup.isError &&
    !balanceError &&
    !checkingBalances &&
    missing.length === 0;
  const actionLabel = hasAgent || hasVault ? 'Continue account setup' : 'Create my account';
  const error = setup.setupError;
  const permissionError = error instanceof WalletAuthorizationError ? error : undefined;
  const transactionError = error instanceof SetupTransactionError ? error : undefined;
  const walletKey = `${connector?.uid}:${address?.toLowerCase()}`;
  const walletNetworks = networkProgress?.walletKey === walletKey ? networkProgress : undefined;
  useEffect(() => {
    setNetworkProgress((progress) => (progress?.walletKey === walletKey ? progress : undefined));
  }, [walletKey]);
  const networkCheck = useQuery({
    queryKey: ['setup-wallet-networks', walletKey],
    queryFn: () => (connector && address ? checkSetupNetworks(connector, address) : []),
    enabled: connected && !!connector,
    networkMode: 'always',
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const knownChains = walletNetworks?.chains ?? networkCheck.data ?? [];
  const networksReady =
    walletNetworks?.done ??
    (networkCheck.isSuccess &&
      !networkCheck.isFetching &&
      SUPPORTED_CHAIN_IDS.every((id) => knownChains.includes(id)));
  const missingNetworks = [testnetTokens.eth.network, testnetTokens.react.network].filter(
    (chain) => !knownChains.includes(chain.chainId),
  );
  const checkingNetworks = !networksReady && networkCheck.isFetching;
  const walletAccess = useMutation({
    mutationKey: ['setup-wallet-access', address, connector?.uid],
    retry: false,
    mutationFn: async (action: 'add-networks' | 'refresh-access') => {
      const signal = walletLifetime.current?.signal;
      if (!signal || !address || connector?.type !== 'injected') {
        throw new Error('Reconnect your browser wallet and try again.');
      }

      const owner = address.toLowerCase();
      const connectorUid = connector.uid;
      const checkWallet = () => {
        signal.throwIfAborted();
        const current = getAccount(config);
        if (current.connector?.uid !== connectorUid || current.address?.toLowerCase() !== owner) {
          throw new Error('Your wallet changed. Reconnect the same account and try again.');
        }
      };

      const provider = (await connector.getProvider()) as EIP1193Provider | undefined;
      if (!provider) throw new Error('The browser wallet is unavailable.');
      const chains = [...knownChains];
      if (action === 'add-networks') {
        // The last approval can leave MetaMask on Lasna for fresh account creation.
        for (const chain of [unichainSepoliaChain, lasnaChain].filter(
          (chain) => !knownChains.includes(chain.id),
        )) {
          checkWallet();
          try {
            await allowSetupNetwork(
              provider,
              {
                chainId: numberToHex(chain.id),
                chainName: chain.name,
                nativeCurrency: chain.nativeCurrency,
                rpcUrls: [...chain.rpcUrls.default.http],
                blockExplorerUrls: [chain.blockExplorers.default.url],
              },
              checkWallet,
            );
          } catch (cause) {
            // Older installs can already have Lasna registered as REACT instead of lREACT.
            const alreadyInstalled =
              chain.id === LASNA_CHAIN_ID &&
              typeof cause === 'object' &&
              cause !== null &&
              'code' in cause &&
              cause.code === InvalidParamsRpcError.code &&
              'message' in cause &&
              typeof cause.message === 'string' &&
              cause.message.includes(
                'nativeCurrency.symbol does not match currency symbol for a network the user already has added with the same chainId',
              );
            if (!alreadyInstalled) {
              throw new Error(
                isWalletRejection(cause)
                  ? `The wallet request for ${chain.name} was cancelled. You can try again.`
                  : `Your wallet could not set up ${chain.name}. Check the network in your wallet, then try again.`,
                { cause },
              );
            }
          }
          checkWallet();
          chains.push(chain.id);
          setNetworkProgress({ walletKey, chains: [...chains], done: false });
        }
      }

      checkWallet();
      let permissions: WalletPermission[] | null = null;
      try {
        permissions = await provider.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch (cause) {
        if (action !== 'add-networks' || !isUnsupportedWalletMethod(cause)) {
          throw new Error(
            isWalletRejection(cause)
              ? 'Wallet access request cancelled. You can try again.'
              : 'Could not refresh access. Disconnect Rulebook in your wallet, then reconnect and allow both networks.',
            { cause },
          );
        }
      }
      const permittedChains = permittedSetupChains(permissions);
      if (permittedChains && permittedChains.length !== SUPPORTED_CHAIN_IDS.length) {
        throw new Error(
          'Allow both Reactive Lasna and Unichain Sepolia in your wallet and try again.',
        );
      }
      const [selected] = await connector.getAccounts();
      if (selected?.toLowerCase() !== owner) {
        throw new Error(`Select wallet ${shortAddress(address)} and allow both networks.`);
      }
      checkWallet();
      if (action === 'add-networks') setNetworkProgress({ walletKey, chains, done: true });
      return permissions !== null;
    },
  });
  const accessRefreshed = walletAccess.data === true;
  const networkAccess = walletAccess.variables === 'add-networks';
  const tokenChoice = tokenReview?.walletKey === walletKey ? tokenReview.choice : undefined;
  const canAutoAdvance = ready && !estimatingFees && !topUps.length;
  useEffect(() => {
    if (networksReady && canAutoAdvance && tokenChoice === undefined) {
      setTokenReview({ walletKey, choice: 'continue' });
    }
  }, [canAutoAdvance, networksReady, tokenChoice, walletKey]);
  const stage =
    !connected || (checkingNetworks && !networkCheck.isFetchedAfterMount)
      ? 'wallet'
      : !networksReady
        ? 'networks'
        : setup.resuming ||
            tokenChoice === 'continue' ||
            (tokenChoice === undefined && (error || canAutoAdvance))
          ? 'create'
          : 'tokens';
  useEffect(() => {
    if (accessRefreshed && !networkAccess && document.activeElement === document.body) {
      continueButton.current?.focus();
    }
  }, [accessRefreshed, networkAccess]);
  let setupErrorMessage = 'Setup paused. Review the wallet error and try again.';
  let setupErrorChain: number | undefined;
  let setupErrorDetail = error instanceof BaseError ? error.shortMessage : error?.message;
  if (transactionError) {
    setupErrorMessage = transactionError.message;
    setupErrorChain = transactionError.chainId;
    setupErrorDetail = undefined;
  } else if (isWalletRejection(error)) {
    setupErrorMessage = 'Wallet request cancelled. Continue setup when you’re ready.';
    setupErrorDetail = undefined;
  } else if (
    error instanceof BaseError &&
    error.walk((cause) => cause instanceof InsufficientFundsError) instanceof InsufficientFundsError
  ) {
    const feeToken = hasAgent && !hasVault ? testnetTokens.eth : testnetTokens.react;
    setupErrorMessage = `Add more test ${feeToken.symbol} on ${feeToken.network.name} to cover the transaction fee.`;
    setupErrorChain = feeToken.network.chainId;
  }

  let nextAction = 'Your wallet is ready for setup.';
  if (!configured) nextAction = 'Account setup is unavailable on this deployment.';
  else if (setup.resuming) nextAction = 'Follow the wallet prompts to finish setup.';
  else if (checkingAccount) nextAction = 'Checking for an existing account…';
  else if (setup.isError) nextAction = 'Check your account status again to continue.';
  else if (balanceError) nextAction = 'A network did not respond. Check balances again.';
  else if (missing.length) nextAction = `Get ${missing.join(' and ')} to continue.`;
  else if (topUps.length)
    nextAction = `Top up ${topUps.join(' and ')} to cover the estimated fees.`;
  else if (checkingBalances) nextAction = 'Checking the wallet balances needed for setup…';
  else if (estimatingFees) nextAction = 'Estimating the fees for your remaining steps…';

  const current = setupStages[stage];
  const accountReadError = setup.error && (
    <ErrorState
      message="Your account status could not be loaded."
      detail={setup.error instanceof BaseError ? setup.error.shortMessage : setup.error.message}
      onRetry={() => void setup.refetch()}
    />
  );

  return (
    <AccountSetupFrame
      title={current.title}
      description={current.description}
      step={current.number}
      connected={connected}
    >
      <section className="app-panel" aria-labelledby="account-setup-title">
        {stage === 'wallet' && (
          <div className="account-setup__section account-setup__wallet">
            <span className="account-setup__wallet-icon" aria-hidden="true">
              <HugeiconsIcon icon={Wallet01Icon} size={22} />
            </span>
            <div>
              {connected ? (
                <p role="status">Checking your wallet’s networks…</p>
              ) : isReconnecting ? (
                <p role="status">Reconnecting your wallet…</p>
              ) : (
                <>
                  <h2>Choose a wallet</h2>
                  <p>Use the same wallet throughout setup.</p>
                  <WalletControl setup />
                </>
              )}
            </div>
          </div>
        )}
        {stage === 'networks' && (
          <div className="account-setup__section account-setup__stack">
            {checkingNetworks ? (
              <p role="status">Checking your wallet’s networks…</p>
            ) : (
              <>
                <p id="setup-network-instructions">
                  {connector?.type === 'walletConnect'
                    ? 'Add both test networks in your wallet, then disconnect and reconnect here. Allow Reactive Lasna and Unichain Sepolia when prompted.'
                    : missingNetworks.length > 0
                      ? `Allow ${missingNetworks.map((network) => network.name).join(' and ')} in your wallet. Your wallet will ask to add any missing networks.`
                      : 'Allow Rulebook to use both test networks in your wallet.'}
                </p>
                <div className="account-setup__action">
                  <button
                    type="button"
                    className="app-button app-button--primary"
                    aria-describedby="setup-network-instructions"
                    disabled={setup.resuming || walletAccess.isPending}
                    onClick={() => {
                      if (networkCheck.isError || connector?.type === 'walletConnect') {
                        void networkCheck.refetch();
                      } else {
                        walletAccess.mutate('add-networks');
                      }
                    }}
                  >
                    {walletAccess.isPending
                      ? 'Waiting for wallet…'
                      : networkCheck.isError || connector?.type === 'walletConnect'
                        ? 'Check wallet connection'
                        : missingNetworks.length === 0
                          ? 'Finish wallet access'
                          : 'Add test networks'}
                  </button>
                </div>
              </>
            )}
            {networkAccess && walletAccess.isPending && (
              <p role="status">
                Approve each request in your wallet. If asked, allow Rulebook on both networks.
              </p>
            )}
            {networkCheck.isError && (
              <p data-tone="warning" role="alert">
                Rulebook couldn’t check your wallet’s networks. Unlock your wallet and try again.
              </p>
            )}
            {networkAccess && walletAccess.error && (
              <p data-tone="warning" role="alert">
                {walletAccess.error.message}
              </p>
            )}
          </div>
        )}
        {stage === 'tokens' && (
          <>
            <div className="account-setup__section">
              <header className="account-setup__token-header">
                <div>
                  <h2>Wallet balances</h2>
                  <p
                    id="account-setup-next"
                    role="status"
                    data-tone={
                      balanceError || missing.length > 0 || topUps.length > 0
                        ? 'warning'
                        : undefined
                    }
                  >
                    {nextAction}
                  </p>
                </div>
                <button
                  type="button"
                  className="app-button"
                  onClick={() => {
                    const options = { cancelRefetch: false };
                    void Promise.all([
                      react.refetch(options),
                      eth.refetch(options),
                      usdc.refetch(options),
                      setup.refetch(options),
                      ...(checkReactFee ? [reactFee.refetch(options)] : []),
                      ...(checkEthFee ? [ethFee.refetch(options)] : []),
                    ]);
                  }}
                >
                  <HugeiconsIcon
                    icon={CircleArrowReload01Icon}
                    size={16}
                    className={refreshing ? 'motion-safe:animate-spin' : undefined}
                    aria-hidden="true"
                  />
                  Check balances
                </button>
              </header>
              <span className="sr-only" role="status">
                {refreshing ? 'Checking wallet balances and fee estimates.' : ''}
              </span>
              {accountReadError}
              {address && <FaucetAddress key={address} address={address} />}
              <ul className="account-setup__tokens" aria-label="Wallet token balances">
                <TokenRow
                  token={testnetTokens.react}
                  purpose={
                    hasAgent
                      ? 'Pays to link your vault on Lasna.'
                      : 'Pays to create your automation account and link your vault.'
                  }
                  required
                  connected={connected}
                  minimum={reactFee.data}
                  estimating={reactFee.isFetching || checkingAccount}
                  balance={{
                    value: react.data?.value,
                    decimals: react.data?.decimals ?? 18,
                    failed: react.isError,
                  }}
                />
                <TokenRow
                  token={testnetTokens.eth}
                  purpose={
                    hasVault
                      ? 'Your vault is created. Keep ETH for wallet transactions on Unichain.'
                      : 'Pays to create your vault on Unichain.'
                  }
                  required={!hasVault}
                  connected={connected}
                  minimum={ethFee.data}
                  estimating={ethFee.isFetching}
                  balance={{
                    value: eth.data?.value,
                    decimals: eth.data?.decimals ?? 18,
                    failed: eth.isError,
                  }}
                />
                <TokenRow
                  token={testnetTokens.usdc}
                  purpose="Optional. You can deposit it during funding if a rule spends USDC."
                  required={false}
                  connected={connected}
                  balance={{ value: usdc.data, decimals: 6, failed: usdc.isError }}
                />
              </ul>
            </div>
            {ready && (
              <div className="account-setup__section account-setup__action">
                <button
                  type="button"
                  className="app-button app-button--primary"
                  onClick={() => setTokenReview({ walletKey, choice: 'continue' })}
                >
                  Continue to account setup
                  <HugeiconsIcon icon={ArrowRight02Icon} size={17} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}

        {stage === 'create' && (
          <div className="account-setup__section account-setup__stack">
            {MIRROR_ENABLED && !checkingAccount && !setup.isError && !hasVault && (
              <label className="app-field">
                Vault mode
                <select
                  className="app-input"
                  value={mirrorVault ? 'mirror' : 'standard'}
                  disabled={setup.resuming}
                  onChange={(event) =>
                    setMirrorOwner(event.target.value === 'mirror' ? address : undefined)
                  }
                >
                  <option value="standard">Standard vault</option>
                  <option value="mirror">Mirror-only vault</option>
                </select>
                <span className="app-copy">Vault mode is permanent once created.</span>
              </label>
            )}
            {accountReadError}
            {!error &&
              !setup.resuming &&
              (balanceError || missing.length > 0 || topUps.length > 0) && (
                <p role="status" data-tone="warning">
                  {nextAction} Select “Review test tokens” for details.
                </p>
              )}
            {permissionError &&
              !setup.resuming &&
              (accessRefreshed ? (
                <p role="status">
                  Wallet access refreshed. Select “{actionLabel}” to retry the remaining steps.
                </p>
              ) : (
                <ErrorState
                  message="Your wallet denied access on this network."
                  chainId={permissionError.chainId}
                >
                  <p className="mt-2">
                    {connector?.type === 'injected'
                      ? 'Refresh wallet access and allow this account on both testnets.'
                      : 'Reconnect with the same wallet and allow both testnets.'}{' '}
                    Then select “{actionLabel}”. Any confirmed steps are saved.
                  </p>
                  {connector?.type === 'injected' && (
                    <>
                      <button
                        type="button"
                        className="app-button mt-3"
                        disabled={walletAccess.isPending}
                        onClick={() => walletAccess.mutate('refresh-access')}
                      >
                        {!networkAccess && walletAccess.isPending
                          ? 'Waiting for wallet…'
                          : 'Refresh wallet access'}
                      </button>
                      <details className="mt-3 text-sm">
                        <summary className="app-link w-fit cursor-pointer">Still blocked?</summary>
                        <p className="mt-2">
                          Disconnect this site in your wallet’s permissions, then reconnect with the
                          same account and allow both testnets.
                        </p>
                      </details>
                    </>
                  )}
                  {!networkAccess && walletAccess.error && (
                    <p className="mt-2" role="alert">
                      {walletAccess.error.message}
                    </p>
                  )}
                </ErrorState>
              ))}
            {error && !permissionError && !setup.resuming && (
              <ErrorState
                message={setupErrorMessage}
                detail={setupErrorDetail}
                chainId={setupErrorChain}
              >
                {transactionError && (
                  <div className="mt-2">
                    <TxLink
                      chainId={transactionError.chainId}
                      txHash={transactionError.txHash}
                      label="View transaction"
                    />
                  </div>
                )}
              </ErrorState>
            )}
            {walletSteps.length > 0 && (
              <SetupReview steps={walletSteps} running={setup.resuming} mirror={mirrorVault} />
            )}
            <div className="account-setup__action account-setup__action--split">
              {!setup.resuming && (
                <button
                  className="app-button"
                  type="button"
                  disabled={walletAccess.isPending}
                  onClick={() => setTokenReview({ walletKey, choice: 'review' })}
                >
                  Review test tokens
                </button>
              )}
              <button
                type="button"
                ref={continueButton}
                className="app-button app-button--primary"
                disabled={!ready || !networksReady || setup.resuming || walletAccess.isPending}
                aria-describedby={walletSteps.length > 0 ? 'setup-wallet-instructions' : undefined}
                onClick={() => {
                  if (!connector || !networksReady) return;
                  onBegin?.();
                  walletAccess.reset();
                  setup.resume({
                    steps: walletSteps,
                    connectorUid: connector.uid,
                    mode: mirrorVault ? 'mirror' : undefined,
                  });
                }}
              >
                {setup.resuming ? 'Setting up your account…' : actionLabel}
                {!setup.resuming && (
                  <HugeiconsIcon icon={ArrowRight02Icon} size={17} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        )}
      </section>
    </AccountSetupFrame>
  );
}
