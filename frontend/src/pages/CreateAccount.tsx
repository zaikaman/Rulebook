import {
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  CircleArrowReload01Icon,
  Copy01Icon,
  InformationCircleIcon,
  LockKeyIcon,
  Tick02Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  automationChainFor,
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  fundsChainIdSchema,
  getChain,
  getFundsChain,
  networkModeForChain,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type ChainConfig,
  type FundsChainId,
} from '@rulebook/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
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
import { Spinner } from '../components/chrome/Spinner.js';
import { AccountFundingStep } from '../components/AccountFundingStep.js';
import { AccountSetupFrame } from '../components/AccountSetupFrame.js';
import { ErrorState } from '../components/ErrorState.js';
import { MainnetUnavailableCallout } from '../components/MainnetUnavailableCallout.js';
import { TxLink } from '../components/TxLink.js';
import type { SetupFundingWallet } from '../hooks/useAccountFunding.js';
import {
  remainingSetupSteps,
  type SetupStep,
  type useAccountSetup,
} from '../hooks/useAccountSetup.js';
import {
  isWalletRejection,
  SetupTransactionError,
  WalletAuthorizationError,
} from '../lib/errors.js';
import { shortAddress } from '../lib/listings.js';
import { useNetworkMode } from '../lib/networkMode.js';
import { appRoutes, safeNextPath } from '../lib/routes.js';
import { roundUpFee } from '../lib/setupFees.js';
import {
  allowSetupNetwork,
  checkSetupNetworks,
  isUnsupportedWalletMethod,
  permittedSetupChains,
} from '../lib/setupNetworks.js';
import { testnetTokens } from '../lib/testnetTokens.js';
import {
  baseMainnetChain,
  baseSepoliaChain,
  lasnaChain,
  reactiveMainnetChain,
  unichainMainnetChain,
  unichainSepoliaChain,
} from '../lib/wagmi.js';
import { Field, Select } from '../ui/index.js';

type Balance = { value?: bigint; decimals: number; failed: boolean };
type Token = {
  readonly symbol: string;
  readonly network: ChainConfig;
  readonly faucet?: string;
  readonly linkLabel?: string;
  readonly instructions?: string;
};

function setupStagesFor(isMainnet: boolean, automationName: string) {
  return {
    wallet: {
      number: 1,
      title: 'Connect your wallet',
      description: 'Use your wallet to create a Rulebook automation account and vault.',
    },
    networks: {
      number: 2,
      title: isMainnet ? 'Set up networks' : 'Set up test networks',
      description: `Rulebook uses ${automationName} for automation and your vault network for settlement.`,
    },
    tokens: {
      number: 3,
      title: isMainnet ? 'Check gas and funds' : 'Get test tokens',
      description: isMainnet
        ? 'Your wallet uses native gas tokens for account creation and optional USDC for vault funding.'
        : 'Your wallet uses test tokens to pay the network fees for setup.',
    },
    create: {
      number: 4,
      title: 'Create your account',
      description: 'Review what Rulebook will set up, then approve the requests in your wallet.',
    },
    funding: {
      number: 5,
      title: 'Fund your account',
      description: isMainnet
        ? 'Add fee credit for workflow runs and optional USDC for your vault. You can adjust any amount or skip this step.'
        : 'Add fee credit for workflow runs and optional test USDC for your vault. You can adjust any amount or skip this step.',
    },
  };
}

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
  walletEstimatesFee = false,
}: {
  token: Token;
  purpose: string;
  required: boolean;
  connected: boolean;
  balance: Balance;
  minimum?: bigint;
  estimating?: boolean;
  walletEstimatesFee?: boolean;
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
          <h3>{token.network.network === 'mainnet' ? token.symbol : `Test ${token.symbol}`}</h3>
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
          <p>
            {estimating
              ? 'Estimating setup fee…'
              : walletEstimatesFee
                ? 'Your wallet shows the network fee before you sign.'
                : 'Setup fee estimate unavailable.'}
          </p>
        )}
        {!required && (
          <p className="account-setup__minimum">
            Required for setup <strong>0 {token.symbol}</strong>
          </p>
        )}
        {token.faucet && (
          <a className="app-link" href={token.faucet} target="_blank" rel="noreferrer">
            {token.linkLabel}
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {token.instructions && (!balance.value || short || balance.failed) && (
          <p>{token.instructions}</p>
        )}
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
  automationNetwork,
  vaultNetwork,
}: {
  steps: readonly SetupStep[];
  running: boolean;
  automationNetwork: string;
  vaultNetwork: string;
}) {
  const actions = {
    agent: { label: 'Create your automation account', network: automationNetwork },
    vault: {
      label: 'Create your vault',
      network: vaultNetwork,
    },
    link: {
      label: 'Link your automation account and vault',
      network: automationNetwork,
    },
  };
  return (
    <section className="account-setup__review" aria-labelledby="setup-wallet-steps">
      <h2 id="setup-wallet-steps">{running ? 'Current wallet request' : 'Wallet steps'}</h2>
      <ol>
        {(running ? steps.slice(0, 1) : steps).map((step) => (
          <li key={step} aria-current={running ? 'step' : undefined}>
            <span>{actions[step].label}</span>
            <small>{actions[step].network}</small>
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
  chainId = UNICHAIN_SEPOLIA_CHAIN_ID,
  availableChains,
  onChainChange,
  fundingWallet,
  startWorkflow = false,
  continueLabel,
  exitHref,
  exitLabel,
  onFundingComplete,
}: {
  setup: ReturnType<typeof useAccountSetup>;
  chainId?: FundsChainId;
  availableChains?: readonly FundsChainId[];
  onChainChange?: (chain: FundsChainId) => void;
  fundingWallet?: SetupFundingWallet;
  startWorkflow?: boolean;
  continueLabel?: string;
  exitHref?: string;
  exitLabel?: string;
  onFundingComplete?: () => void;
}) {
  const { isDeploymentConfigured } = useNetworkMode();
  const mode = networkModeForChain(chainId);
  const isMainnet = mode === 'mainnet';
  const automationChainId = automationChainFor(mode);
  const autoNetwork = getChain(automationChainId);
  const autoWagmiChain = isMainnet ? reactiveMainnetChain : lasnaChain;
  const fundsChain =
    chainId === BASE_MAINNET_CHAIN_ID
      ? baseMainnetChain
      : chainId === UNICHAIN_MAINNET_CHAIN_ID
        ? unichainMainnetChain
        : chainId === BASE_SEPOLIA_CHAIN_ID
          ? baseSepoliaChain
          : unichainSepoliaChain;
  const fundsConfig = getFundsChain(fundsChain.id);
  const reactToken: Token = isMainnet
    ? { symbol: autoNetwork.nativeSymbol, network: autoNetwork }
    : testnetTokens.react;
  const ethToken: Token = isMainnet
    ? { symbol: 'ETH', network: fundsConfig }
    : chainId === BASE_SEPOLIA_CHAIN_ID
      ? testnetTokens.baseEth
      : testnetTokens.eth;
  const usdcToken: Token = isMainnet
    ? { symbol: 'USDC', network: fundsConfig }
    : chainId === BASE_SEPOLIA_CHAIN_ID
      ? testnetTokens.baseUsdc
      : testnetTokens.usdc;
  const setupStages = setupStagesFor(isMainnet, autoNetwork.name);
  const requiredChainIds: readonly number[] = [fundsChain.id, automationChainId];
  const { address, connector, isReconnecting } = useAccount();
  const [searchParams] = useSearchParams();
  const setupNext = safeNextPath(searchParams.get('next'), '');
  const manageParams = new URLSearchParams({ chain: String(chainId) });
  if (setupNext) manageParams.set('next', setupNext);
  const manageAccountHref = `${appRoutes.accountFunds}?${manageParams.toString()}`;
  const config = useConfig();
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

  const hasAgent = !!setup.data?.agent;
  const hasVault = !!setup.data?.vault;
  const walletSteps = setup.data ? remainingSetupSteps(setup.data) : [];
  const query = { enabled: connected, refetchOnWindowFocus: 'always' } as const;
  const react = useBalance({ address, chainId: automationChainId, query });
  const eth = useBalance({ address, chainId: fundsChain.id, query });
  const usdc = useReadContract({
    address: fundsConfig.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? zeroAddress],
    chainId: fundsChain.id,
    query,
  });

  const checkingAccount = setup.isLoading || isReconnecting;
  const missing = [
    !react.isError && react.data?.value === 0n
      ? `${isMainnet ? '' : 'test '}${autoNetwork.nativeSymbol}`
      : null,
    !hasVault && !eth.isError && eth.data?.value === 0n ? `${isMainnet ? '' : 'test '}ETH` : null,
  ].filter(Boolean);

  const balanceError = react.isError || (!hasVault && eth.isError);
  const checkingBalances = react.data === undefined || (!hasVault && eth.data === undefined);
  const refreshing = react.isFetching || eth.isFetching;
  const ready =
    connected &&
    !!connector &&
    walletSteps.length > 0 &&
    !checkingAccount &&
    !setup.isError &&
    !balanceError &&
    !checkingBalances &&
    missing.length === 0;
  const actionLabel = hasAgent || hasVault ? 'Continue account setup' : 'Create my account';
  const error = setup.setupError;
  const permissionError = error instanceof WalletAuthorizationError ? error : undefined;
  const transactionError = error instanceof SetupTransactionError ? error : undefined;
  const walletKey = `${connector?.uid}:${address?.toLowerCase()}:${chainId}`;
  const walletNetworks = networkProgress?.walletKey === walletKey ? networkProgress : undefined;
  useEffect(() => {
    setNetworkProgress((progress) => (progress?.walletKey === walletKey ? progress : undefined));
  }, [walletKey]);
  const networkCheck = useQuery({
    queryKey: ['setup-wallet-networks', walletKey],
    queryFn: () =>
      connector && address ? checkSetupNetworks(connector, address, requiredChainIds) : [],
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
      requiredChainIds.every((id) => knownChains.includes(id)));
  const missingNetworks = [ethToken.network, reactToken.network].filter(
    (chain) => !knownChains.includes(chain.chainId),
  );
  const checkingNetworks = !networksReady && networkCheck.isFetching;
  const walletAccess = useMutation({
    mutationKey: ['setup-wallet-access', address, connector?.uid, chainId],
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
        // The last approval can leave MetaMask on the automation chain for fresh account creation.
        for (const chain of [fundsChain, autoWagmiChain].filter(
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
              chain.id === automationChainId &&
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
      const permittedChains = permittedSetupChains(permissions, requiredChainIds);
      if (permittedChains && !requiredChainIds.every((id) => permittedChains.includes(id))) {
        throw new Error(
          `Allow both ${autoNetwork.name} and ${fundsChain.name} in your wallet and try again.`,
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
  const resetWalletAccess = walletAccess.reset;
  useEffect(() => {
    resetWalletAccess();
  }, [walletKey, resetWalletAccess]);
  const tokenChoice = tokenReview?.walletKey === walletKey ? tokenReview.choice : undefined;
  const canAutoAdvance = ready;
  useEffect(() => {
    if (networksReady && canAutoAdvance && tokenChoice === undefined) {
      setTokenReview({ walletKey, choice: 'continue' });
    }
  }, [canAutoAdvance, networksReady, tokenChoice, walletKey]);
  const fundingReady = Boolean(
    connected &&
    address &&
    setup.data?.linked &&
    setup.data.agent &&
    setup.data.vault &&
    fundingWallet,
  );
  const stage = !connected
    ? 'wallet'
    : fundingReady
      ? 'funding'
      : checkingNetworks && !networkCheck.isFetchedAfterMount
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
    const feeToken = hasAgent && !hasVault ? ethToken : reactToken;
    setupErrorMessage = `Add more ${isMainnet ? '' : 'test '}${feeToken.symbol} on ${feeToken.network.name} to cover the transaction fee.`;
    setupErrorChain = feeToken.network.chainId;
  }

  let nextAction = 'Your wallet is ready for setup.';
  if (setup.resuming) nextAction = 'Follow the wallet prompts to finish setup.';
  else if (checkingAccount) nextAction = 'Checking for an existing account…';
  else if (setup.isError) nextAction = 'Check your account status again to continue.';
  else if (balanceError) nextAction = 'A network did not respond. Check balances again.';
  else if (missing.length) nextAction = `Get ${missing.join(' and ')} to continue.`;
  else if (checkingBalances) nextAction = 'Checking the wallet balances needed for setup…';

  const current = setupStages[stage];
  const currentDescription =
    stage === 'networks'
      ? `Rulebook uses ${autoNetwork.name} for automation and ${fundsChain.name} for your vault.`
      : current.description;
  const showChainPicker = Boolean(
    availableChains && availableChains.length > 1 && onChainChange && stage !== 'funding',
  );
  const accountReadError = setup.error && (
    <ErrorState
      message="Your account status could not be loaded."
      detail={setup.error instanceof BaseError ? setup.error.shortMessage : setup.error.message}
      onRetry={() => void setup.refetch()}
    />
  );

  if (isMainnet && !isDeploymentConfigured) {
    return (
      <AccountSetupFrame
        title="Account setup"
        workflow
        manageAccount={false}
        manageAccountHref={appRoutes.accountFunds}
        automationNetwork={autoNetwork.name}
        vaultNetwork={fundsChain.name}
        isMainnet={isMainnet}
        description={`Rulebook uses ${autoNetwork.name} for automation and ${fundsChain.name} for your vault.`}
        step={1}
        connected={connected}
      >
        <MainnetUnavailableCallout context="Account setup" />
      </AccountSetupFrame>
    );
  }

  return (
    <AccountSetupFrame
      title={current.title}
      workflow
      manageAccount={hasVault}
      manageAccountHref={manageAccountHref}
      exitHref={exitHref}
      exitLabel={exitLabel}
      automationNetwork={autoNetwork.name}
      vaultNetwork={fundsChain.name}
      isMainnet={isMainnet}
      description={currentDescription}
      step={current.number}
      connected={connected}
    >
      <section className="app-panel" aria-labelledby="account-setup-title">
        {showChainPicker && availableChains && onChainChange && (
          <div className="account-setup__network-choice">
            <Field
              label="Vault network"
              hint="Choose where your first vault settles. You can add another network later in Account & Vault."
            >
              {(ids) => (
                <Select
                  value={String(chainId)}
                  aria-describedby={ids.hint}
                  disabled={setup.resuming || walletAccess.isPending}
                  groups={[
                    {
                      label: 'Vault network',
                      options: availableChains.map((id) => ({
                        value: String(id),
                        label: getChain(id).name,
                      })),
                    },
                  ]}
                  onChange={(nextValue) => {
                    const parsed = fundsChainIdSchema.safeParse(Number(nextValue));
                    if (parsed.success && parsed.data !== chainId) {
                      onChainChange(parsed.data);
                    }
                  }}
                />
              )}
            </Field>
          </div>
        )}
        {stage === 'wallet' && (
          <div className="account-setup__section account-setup__wallet">
            <span className="account-setup__wallet-icon" aria-hidden="true">
              <HugeiconsIcon icon={Wallet01Icon} size={24} strokeWidth={1.6} />
            </span>
            <div className="account-setup__wallet-copy">
              {connected ? (
                <p className="rb-loading" role="status">
                  <Spinner />
                  Checking your wallet’s networks…
                </p>
              ) : isReconnecting ? (
                <p className="rb-loading" role="status">
                  <Spinner />
                  Reconnecting your wallet…
                </p>
              ) : (
                <>
                  <h2>Choose a wallet</h2>
                  <p>
                    Use the same wallet throughout setup. Rulebook never takes custody of your
                    funds.
                  </p>
                  <ul className="account-setup__wallet-facts">
                    <li>
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={13}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                      Same wallet for {autoNetwork.name} and {fundsChain.name}
                    </li>
                    <li>
                      <HugeiconsIcon
                        icon={LockKeyIcon}
                        size={13}
                        strokeWidth={1.9}
                        aria-hidden="true"
                      />
                      Keys stay in your wallet
                    </li>
                    <li>
                      <HugeiconsIcon
                        icon={InformationCircleIcon}
                        size={13}
                        strokeWidth={1.9}
                        aria-hidden="true"
                      />
                      {isMainnet ? 'Mainnet · real funds' : 'Testnet only'}
                    </li>
                  </ul>
                  <div className="account-setup__connect">
                    <WalletControl setup />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {stage === 'networks' && (
          <div className="account-setup__section account-setup__stack">
            {checkingNetworks ? (
              <p className="rb-loading" role="status">
                <Spinner />
                Checking your wallet’s networks…
              </p>
            ) : (
              <>
                <p id="setup-network-instructions">
                  {connector?.type === 'walletConnect'
                    ? `Add ${autoNetwork.name} and ${fundsChain.name} in your wallet, then disconnect and reconnect here. Allow both when prompted.`
                    : missingNetworks.length > 0
                      ? `Allow ${missingNetworks.map((network) => network.name).join(' and ')} in your wallet. Your wallet will ask to add any missing networks.`
                      : `Allow Rulebook to use ${autoNetwork.name} and ${fundsChain.name} in your wallet.`}
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
                    {walletAccess.isPending && <Spinner />}
                    {walletAccess.isPending
                      ? 'Waiting for wallet…'
                      : networkCheck.isError || connector?.type === 'walletConnect'
                        ? 'Check wallet connection'
                        : missingNetworks.length === 0
                          ? 'Finish wallet access'
                          : isMainnet
                            ? 'Add networks'
                            : 'Add test networks'}
                  </button>
                </div>
              </>
            )}
            {networkAccess && walletAccess.isPending && (
              <p className="rb-loading" role="status">
                <Spinner />
                Approve each request in your wallet. If asked, allow Rulebook on {
                  autoNetwork.name
                }{' '}
                and {fundsChain.name}.
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
                    data-tone={balanceError || missing.length > 0 ? 'warning' : undefined}
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
              {!isMainnet && address && <FaucetAddress key={address} address={address} />}
              <ul className="account-setup__tokens" aria-label="Wallet token balances">
                <TokenRow
                  token={reactToken}
                  purpose={
                    hasAgent
                      ? `Pays to link your vault on ${autoNetwork.name}.`
                      : 'Pays to create your automation account and link your vault.'
                  }
                  required
                  connected={connected}
                  estimating={checkingAccount}
                  walletEstimatesFee
                  balance={{
                    value: react.data?.value,
                    decimals: react.data?.decimals ?? 18,
                    failed: react.isError,
                  }}
                />
                <TokenRow
                  token={ethToken}
                  purpose={
                    hasVault
                      ? `Your vault is created. Keep ETH for wallet transactions on ${fundsChain.name}.`
                      : `Pays to create your vault on ${fundsChain.name}.`
                  }
                  required={!hasVault}
                  connected={connected}
                  estimating={false}
                  walletEstimatesFee
                  balance={{
                    value: eth.data?.value,
                    decimals: eth.data?.decimals ?? 18,
                    failed: eth.isError,
                  }}
                />
                <TokenRow
                  token={usdcToken}
                  purpose="Optional. You can deposit it during funding if a workflow spends USDC."
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
            {accountReadError}
            {!error && !setup.resuming && (balanceError || missing.length > 0) && (
              <p role="status" data-tone="warning">
                {nextAction} Select “{isMainnet ? 'Review balances' : 'Review test tokens'}” for
                details.
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
                      ? `Refresh wallet access and allow this account on ${autoNetwork.name} and ${fundsChain.name}.`
                      : `Reconnect with the same wallet and allow ${autoNetwork.name} and ${fundsChain.name}.`}{' '}
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
                        {!networkAccess && walletAccess.isPending && <Spinner />}
                        {!networkAccess && walletAccess.isPending
                          ? 'Waiting for wallet…'
                          : 'Refresh wallet access'}
                      </button>
                      <details className="mt-3 text-sm">
                        <summary className="app-link w-fit cursor-pointer">Still blocked?</summary>
                        <p className="mt-2">
                          Disconnect this site in your wallet’s permissions, then reconnect with the
                          same account and allow {autoNetwork.name} and {fundsChain.name}.
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
              <SetupReview
                steps={walletSteps}
                running={setup.resuming}
                automationNetwork={autoNetwork.name}
                vaultNetwork={fundsChain.name}
              />
            )}
            <div className="account-setup__action account-setup__action--split">
              {!setup.resuming && (
                <button
                  className="app-button"
                  type="button"
                  disabled={walletAccess.isPending}
                  onClick={() => setTokenReview({ walletKey, choice: 'review' })}
                >
                  {isMainnet ? 'Review balances' : 'Review test tokens'}
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
                  walletAccess.reset();
                  setup.resume({
                    steps: walletSteps,
                    connectorUid: connector.uid,
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
        {stage === 'funding' && address && fundingWallet && (
          <AccountFundingStep
            owner={address.toLowerCase() as Address}
            chainId={chainId}
            fundingWallet={fundingWallet}
            startWorkflow={startWorkflow}
            continueLabel={continueLabel}
            onComplete={onFundingComplete ?? (() => {})}
          />
        )}
      </section>
    </AccountSetupFrame>
  );
}
