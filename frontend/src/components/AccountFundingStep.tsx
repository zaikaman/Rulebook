import { ArrowRight02Icon, CircleArrowReload01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  automationChainFor,
  estimateCreditRunway,
  estimatedGasPerRunLabel,
  feeCreditWarningThreshold,
  formatRunwayRuns,
  getChain,
  networkModeForChain,
  type Address,
  type FeeCreditKind,
  type FundsChainId,
} from '@rulebook/shared';
import { useEffect, useRef, useState } from 'react';
import { BaseError, InsufficientFundsError, zeroAddress } from 'viem';
import { useAccount } from 'wagmi';

import {
  defaultFundingAmounts,
  exactUnits,
  parseFundingAmount,
  suggestedExecutionCreditFor,
  suggestedWatchingCreditFor,
  useAccountFunding,
  type FundingPlanItem,
  type SetupFundingItemId,
  type SetupFundingWallet,
} from '../hooks/useAccountFunding.js';
import {
  isWalletRejection,
  SetupTransactionError,
  WalletAuthorizationError,
} from '../lib/errors.js';
import { creditFaucetFor, usdcFaucetFor } from '../lib/testnetTokens.js';
import { Badge, Button, ErrorState, ExternalLink, Field, RunwayReadout } from '../ui/index.js';
import { useChainGasPrices } from '../workflows/useGasPrices.js';
import { Spinner } from './chrome/Spinner.js';
import { NetworkBadge } from './NetworkBadge.js';
import { TxLink } from './TxLink.js';

function renderFundingRunway({
  kind,
  currentReserve,
  debt,
  enteredAmount,
  threshold,
  suggested,
  symbol,
  runCost,
  gasPending,
}: {
  kind: FeeCreditKind;
  currentReserve: bigint;
  debt: bigint | null;
  enteredAmount: bigint;
  threshold: bigint;
  suggested: bigint;
  symbol: string;
  runCost: bigint | null | undefined;
  gasPending: boolean;
}) {
  if (!runCost || debt === null) {
    return (
      <RunwayReadout
        size="compact"
        tone="muted"
        value={gasPending ? 'Estimating…' : 'Runway unavailable'}
        detail={gasPending ? 'Reading network fee pricing.' : undefined}
        className="account-setup__funding-runway"
      />
    );
  }

  const totalReserve = currentReserve + enteredAmount;
  const gasAssumption = estimatedGasPerRunLabel(kind);
  if (totalReserve > 0n || debt > 0n) {
    const runway = estimateCreditRunway({
      reserveWei: totalReserve,
      debtWei: debt,
      estimatedCostPerRunWei: runCost,
    });
    if (!runway) return null;
    const tone =
      debt > enteredAmount
        ? 'danger'
        : runway.depleted || runway.underOneRun
          ? 'paused'
          : runway.netReserveWei >= threshold
            ? 'active'
            : 'default';
    const detail =
      debt > 0n
        ? `Fees due: ${exactUnits(debt, 18)} ${symbol}. Deposits pay fees first.`
        : enteredAmount > 0n && currentReserve > 0n
          ? `Total with deposit (${exactUnits(totalReserve, 18)} ${symbol}) · ${gasAssumption}`
          : enteredAmount > 0n
            ? `For this ${exactUnits(enteredAmount, 18)} ${symbol} deposit · ${gasAssumption}`
            : `From current ${exactUnits(currentReserve, 18)} ${symbol} reserve · ${gasAssumption}`;
    return (
      <RunwayReadout
        size="compact"
        value={formatRunwayRuns(runway)}
        detail={detail}
        tone={tone}
        className="account-setup__funding-runway"
      />
    );
  }

  const suggestedRunway = estimateCreditRunway({
    reserveWei: suggested,
    estimatedCostPerRunWei: runCost,
  });
  if (!suggestedRunway) return null;
  return (
    <RunwayReadout
      size="compact"
      tone="muted"
      value={`Suggested ${exactUnits(suggested, 18)} ${symbol}`}
      detail={`Covers ${formatRunwayRuns(suggestedRunway, { suffix: 'none' })} at live gas · ${gasAssumption}`}
      className="account-setup__funding-runway"
    />
  );
}

export function AccountFundingStep({
  owner,
  chainId,
  fundingWallet,
  startWorkflow = false,
  continueLabel: customContinueLabel,
  onComplete,
}: {
  owner: Address;
  chainId: FundsChainId;
  fundingWallet: SetupFundingWallet;
  startWorkflow?: boolean;
  continueLabel?: string;
  onComplete: () => void;
}) {
  const { connector } = useAccount();
  const {
    fundsQuery,
    confirmed,
    activeItem,
    failedItem,
    deposit,
    depositing,
    depositError,
    resetError,
  } = useAccountFunding({ owner, chainId, fundingWallet });

  const [amounts, setAmounts] = useState<Record<SetupFundingItemId, string>>({
    watching: '',
    execution: '',
    usdc: '',
  });
  const initializedKey = useRef<string | undefined>(undefined);
  const continueRef = useRef<HTMLButtonElement>(null);
  const prevAllConfirmed = useRef(false);

  const funds = fundsQuery.data;
  const initKey = funds
    ? `${owner.toLowerCase()}:${chainId}:${funds.vault.toLowerCase()}`
    : undefined;

  useEffect(() => {
    if (!funds || !initKey || initializedKey.current === initKey) return;
    initializedKey.current = initKey;
    setAmounts(defaultFundingAmounts(funds, chainId));
  }, [funds, initKey, chainId]);

  const settlementNetwork = getChain(chainId);
  const mode = networkModeForChain(chainId);
  const isMainnet = mode === 'mainnet';
  const autoChainId = automationChainFor(mode);
  const lasnaNetwork = getChain(autoChainId);
  const watchSymbol = lasnaNetwork.nativeSymbol;
  const [watchGasQuery, execGasQuery] = useChainGasPrices([autoChainId, chainId], mode);
  const watchFaucet = !isMainnet ? creditFaucetFor(autoChainId) : undefined;
  const execFaucet = !isMainnet ? creditFaucetFor(chainId) : undefined;
  const usdcFaucet = !isMainnet ? usdcFaucetFor(chainId) : undefined;

  const watchingParsed = parseFundingAmount(amounts.watching, 18, watchSymbol, funds?.walletWatch);
  const executionParsed = parseFundingAmount(amounts.execution, 18, 'ETH', funds?.walletNative);
  const usdcParsed = parseFundingAmount(amounts.usdc, 6, 'USDC', funds?.walletStable);

  const hasFieldError = Boolean(
    (!confirmed.watching && watchingParsed.error) ||
    (!confirmed.execution && executionParsed.error) ||
    (!confirmed.usdc && usdcParsed.error),
  );

  const executionAvailable = Boolean(funds?.proxy && funds.proxy !== zeroAddress);
  const usdcAvailable = Boolean(funds && funds.usdc !== zeroAddress);

  const plannedItems: FundingPlanItem[] = [];
  if (funds && !confirmed.watching && watchingParsed.amount) {
    plannedItems.push({
      id: 'watching',
      amount: watchingParsed.amount,
      display: `${exactUnits(watchingParsed.amount, 18)} ${watchSymbol}`,
      chainId: autoChainId,
      label: `Deposit ${exactUnits(watchingParsed.amount, 18)} ${watchSymbol} for watching credit`,
      networkName: lasnaNetwork.name,
    });
  }
  if (funds && executionAvailable && !confirmed.execution && executionParsed.amount) {
    plannedItems.push({
      id: 'execution',
      amount: executionParsed.amount,
      display: `${exactUnits(executionParsed.amount, 18)} ETH`,
      chainId,
      label: `Deposit ${exactUnits(executionParsed.amount, 18)} ETH for execution credit`,
      networkName: settlementNetwork.name,
    });
  }
  if (funds && usdcAvailable && !confirmed.usdc && usdcParsed.amount) {
    plannedItems.push({
      id: 'usdc',
      amount: usdcParsed.amount,
      display: `${exactUnits(usdcParsed.amount, 6)} USDC`,
      chainId,
      label: `Deposit ${exactUnits(usdcParsed.amount, 6)} USDC to your vault`,
      networkName: settlementNetwork.name,
    });
  }

  const confirmedCount = Object.values(confirmed).filter(Boolean).length;
  const allConfirmed =
    confirmedCount > 0 && plannedItems.length === 0 && !hasFieldError && !depositing;
  const canAddMore = Boolean(
    !confirmed.watching ||
    (executionAvailable && !confirmed.execution) ||
    (usdcAvailable && !confirmed.usdc),
  );

  useEffect(() => {
    if (allConfirmed && !prevAllConfirmed.current && document.activeElement === document.body) {
      continueRef.current?.focus();
    }
    prevAllConfirmed.current = allConfirmed;
  }, [allConfirmed]);

  function handleAmountChange(id: SetupFundingItemId, value: string) {
    if (depositError) resetError();
    setAmounts((current) => ({ ...current, [id]: value }));
  }

  const continueLabel =
    customContinueLabel ?? (startWorkflow ? 'Start building' : 'Open Account & Vault');
  const watchingThreshold = feeCreditWarningThreshold(autoChainId);
  const executionThreshold = feeCreditWarningThreshold(chainId);

  let statusLine = 'Pre-filled from your wallet balances. Leave any field blank to skip it.';
  if (fundsQuery.isPending) {
    statusLine = 'Loading your wallet and account balances.';
  } else if (fundsQuery.isError) {
    statusLine = 'Account balances could not be checked.';
  } else if (depositing) {
    statusLine = 'Follow the wallet prompts to confirm your selected deposits.';
  } else if (allConfirmed) {
    statusLine = 'Selected deposits are confirmed on-chain.';
  }

  let errorNode = null;
  if (depositError && !depositing) {
    const savedNotice = confirmedCount > 0 ? ' Any confirmed deposits are saved.' : '';
    if (depositError instanceof SetupTransactionError) {
      errorNode = (
        <ErrorState message={depositError.message} chainId={depositError.chainId}>
          <div className="mt-2">
            <TxLink
              chainId={depositError.chainId}
              txHash={depositError.txHash}
              label="View transaction"
            />
          </div>
        </ErrorState>
      );
    } else if (depositError instanceof WalletAuthorizationError) {
      errorNode = (
        <ErrorState
          message="Your wallet denied access on this network."
          chainId={depositError.chainId}
        >
          <p className="mt-2">
            Allow this account on {lasnaNetwork.name} and {settlementNetwork.name} in your wallet,
            then retry the remaining deposits.
            {savedNotice}
          </p>
        </ErrorState>
      );
    } else if (isWalletRejection(depositError)) {
      errorNode = <ErrorState message={`Wallet request cancelled.${savedNotice}`} />;
    } else if (
      depositError instanceof BaseError &&
      depositError.walk((cause) => cause instanceof InsufficientFundsError) instanceof
        InsufficientFundsError
    ) {
      const feeNetwork = failedItem === 'watching' ? lasnaNetwork : settlementNetwork;
      const feeSymbol = failedItem === 'watching' ? watchSymbol : 'ETH';
      errorNode = (
        <ErrorState
          message={`Leave a little ${isMainnet ? '' : 'test '}${feeSymbol} on ${feeNetwork.name} to cover the transaction fee.${savedNotice}`}
          chainId={feeNetwork.chainId}
        />
      );
    } else {
      const failedChain =
        failedItem === 'watching' ? autoChainId : failedItem ? chainId : undefined;
      errorNode = (
        <ErrorState
          message={`A deposit could not be completed.${savedNotice}`}
          detail={
            depositError instanceof BaseError
              ? depositError.shortMessage
              : depositError instanceof Error
                ? depositError.message
                : String(depositError)
          }
          chainId={failedChain}
        />
      );
    }
  }

  function renderBadge(
    id: SetupFundingItemId,
    funded: boolean,
    fundedLabel: string,
    defaultLabel: string,
    defaultTone?: 'paused',
  ) {
    if (confirmed[id]) {
      return (
        <Badge tone="active">
          <HugeiconsIcon icon={Tick02Icon} size={12} aria-hidden="true" />
          Confirmed
        </Badge>
      );
    }
    if (depositing && activeItem === id) {
      return <Badge tone="info">Confirm in wallet…</Badge>;
    }
    if (funded) {
      return <Badge tone="active">{fundedLabel}</Badge>;
    }
    return (
      <Badge tone={defaultTone} plain={!defaultTone}>
        {defaultLabel}
      </Badge>
    );
  }

  return (
    <>
      <div className="account-setup__section">
        <header className="account-setup__token-header">
          <div>
            <h2>Starting deposits</h2>
            <p role={depositing ? 'status' : undefined}>{statusLine}</p>
          </div>
          <Button disabled={depositing} onClick={() => void fundsQuery.refetch()}>
            <HugeiconsIcon
              icon={CircleArrowReload01Icon}
              size={16}
              className={fundsQuery.isFetching ? 'motion-safe:animate-spin' : undefined}
              aria-hidden="true"
            />
            Refresh balances
          </Button>
        </header>

        {fundsQuery.isPending && (
          <p className="account-setup__loading" role="status">
            <Spinner />
            Checking wallet and account balances…
          </p>
        )}

        {fundsQuery.isError && (
          <div className="account-setup__funding-error">
            <ErrorState
              message="Account balances could not be loaded."
              detail={
                fundsQuery.error instanceof BaseError
                  ? fundsQuery.error.shortMessage
                  : fundsQuery.error.message
              }
              onRetry={() => void fundsQuery.refetch()}
            />
          </div>
        )}

        {funds && (
          <ul className="account-setup__funding-list" aria-label="Starting deposits">
            <li className="account-setup__funding-item" data-network="automation">
              <div className="account-setup__funding-head">
                <div className="account-setup__funding-title">
                  <span className="account-setup__network-dot" aria-hidden="true" />
                  <h3>Watching credit</h3>
                  <NetworkBadge chainId={autoChainId} />
                </div>
                <div className="account-setup__funding-status">
                  {renderBadge(
                    'watching',
                    funds.watch >= watchingThreshold,
                    'Funded',
                    'Recommended',
                    'paused',
                  )}
                  {confirmed.watching && (
                    <TxLink
                      chainId={autoChainId}
                      txHash={confirmed.watching}
                      label="View transaction"
                    />
                  )}
                </div>
              </div>
              <p>Pays your agent to watch triggers and evaluate rules.</p>
              <div className="account-setup__funding-field">
                <Field
                  label={`Watching credit (${watchSymbol})`}
                  hint={`Wallet: ${exactUnits(funds.walletWatch, 18)} ${watchSymbol}${funds.watch > 0n ? ` · Current reserve: ${exactUnits(funds.watch, 18)} ${watchSymbol}` : ''}. Keep a little for network gas.`}
                  error={!confirmed.watching ? watchingParsed.error : undefined}
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      inputMode="decimal"
                      value={amounts.watching}
                      placeholder={exactUnits(suggestedWatchingCreditFor(autoChainId), 18)}
                      disabled={depositing || Boolean(confirmed.watching)}
                      aria-invalid={!confirmed.watching && watchingParsed.error ? true : undefined}
                      aria-describedby={
                        [ids.hint, !confirmed.watching ? ids.error : undefined]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      onChange={(event) => handleAmountChange('watching', event.target.value)}
                    />
                  )}
                </Field>
                {renderFundingRunway({
                  kind: 'watching',
                  currentReserve: funds.watch,
                  debt: funds.watchDebt,
                  enteredAmount:
                    !confirmed.watching && watchingParsed.amount ? watchingParsed.amount : 0n,
                  threshold: watchingThreshold,
                  suggested: suggestedWatchingCreditFor(autoChainId),
                  symbol: watchSymbol,
                  runCost: watchGasQuery?.isError ? null : watchGasQuery?.data?.runCostWei,
                  gasPending: Boolean(watchGasQuery?.isPending),
                })}
                {watchFaucet && !confirmed.watching && (
                  <>
                    <ExternalLink
                      className="account-setup__funding-faucet"
                      href={watchFaucet.faucet}
                    >
                      {watchFaucet.linkLabel}
                    </ExternalLink>
                    {(funds.walletWatch === 0n ||
                      (!watchingParsed.amount && funds.watch < watchingThreshold)) && (
                      <p className="account-setup__funding-faucet-note">
                        {watchFaucet.instructions}
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>

            <li className="account-setup__funding-item" data-network="funds">
              <div className="account-setup__funding-head">
                <div className="account-setup__funding-title">
                  <span className="account-setup__network-dot" aria-hidden="true" />
                  <h3>Execution credit</h3>
                  <NetworkBadge chainId={chainId} />
                </div>
                <div className="account-setup__funding-status">
                  {renderBadge(
                    'execution',
                    funds.execution >= executionThreshold,
                    'Funded',
                    'Recommended',
                    'paused',
                  )}
                  {confirmed.execution && (
                    <TxLink
                      chainId={chainId}
                      txHash={confirmed.execution}
                      label="View transaction"
                    />
                  )}
                </div>
              </div>
              <p>Pays the callback proxy to settle runs on your vault.</p>
              <div className="account-setup__funding-field">
                <Field
                  label="Execution credit (ETH)"
                  hint={
                    executionAvailable
                      ? `Wallet: ${exactUnits(funds.walletNative, 18)} ETH${funds.execution > 0n ? ` · Current reserve: ${exactUnits(funds.execution, 18)} ETH` : ''}. Keep a little for network gas.`
                      : `Callback proxy unavailable on ${settlementNetwork.name}.`
                  }
                  error={!confirmed.execution ? executionParsed.error : undefined}
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      inputMode="decimal"
                      value={amounts.execution}
                      placeholder={exactUnits(suggestedExecutionCreditFor(chainId), 18)}
                      disabled={depositing || Boolean(confirmed.execution) || !executionAvailable}
                      aria-invalid={
                        !confirmed.execution && executionParsed.error ? true : undefined
                      }
                      aria-describedby={
                        [ids.hint, !confirmed.execution ? ids.error : undefined]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      onChange={(event) => handleAmountChange('execution', event.target.value)}
                    />
                  )}
                </Field>
                {executionAvailable &&
                  renderFundingRunway({
                    kind: 'execution',
                    currentReserve: funds.execution,
                    debt: funds.executionDebt,
                    enteredAmount:
                      !confirmed.execution && executionParsed.amount ? executionParsed.amount : 0n,
                    threshold: executionThreshold,
                    suggested: suggestedExecutionCreditFor(chainId),
                    symbol: 'ETH',
                    runCost: execGasQuery?.isError ? null : execGasQuery?.data?.runCostWei,
                    gasPending: Boolean(execGasQuery?.isPending),
                  })}
                {execFaucet && executionAvailable && !confirmed.execution && (
                  <>
                    <ExternalLink
                      className="account-setup__funding-faucet"
                      href={execFaucet.faucet}
                    >
                      {execFaucet.linkLabel}
                    </ExternalLink>
                    {(funds.walletNative === 0n ||
                      (!executionParsed.amount && funds.execution < executionThreshold)) && (
                      <p className="account-setup__funding-faucet-note">
                        {execFaucet.instructions}
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>

            <li className="account-setup__funding-item" data-network="funds">
              <div className="account-setup__funding-head">
                <div className="account-setup__funding-title">
                  <span className="account-setup__network-dot" aria-hidden="true" />
                  <h3>Vault USDC</h3>
                  <NetworkBadge chainId={chainId} />
                </div>
                <div className="account-setup__funding-status">
                  {renderBadge('usdc', funds.stable > 0n, 'In vault', 'Optional')}
                  {confirmed.usdc && (
                    <TxLink chainId={chainId} txHash={confirmed.usdc} label="View transaction" />
                  )}
                </div>
              </div>
              <p>Principal for workflows that buy, transfer, or refill with USDC.</p>
              <div className="account-setup__funding-field">
                <Field
                  label="Vault USDC (USDC)"
                  hint={
                    usdcAvailable
                      ? `Wallet: ${exactUnits(funds.walletStable, 6)} USDC${funds.stable > 0n ? ` · In vault: ${exactUnits(funds.stable, 6)} USDC` : ''}.`
                      : `${isMainnet ? '' : 'Test '}USDC is unavailable on ${settlementNetwork.name}.`
                  }
                  error={!confirmed.usdc ? usdcParsed.error : undefined}
                >
                  {(ids) => (
                    <input
                      className="app-input"
                      inputMode="decimal"
                      value={amounts.usdc}
                      placeholder="10"
                      disabled={depositing || Boolean(confirmed.usdc) || !usdcAvailable}
                      aria-invalid={!confirmed.usdc && usdcParsed.error ? true : undefined}
                      aria-describedby={
                        [ids.hint, !confirmed.usdc ? ids.error : undefined]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      onChange={(event) => handleAmountChange('usdc', event.target.value)}
                    />
                  )}
                </Field>
                {usdcFaucet && usdcAvailable && !confirmed.usdc && (
                  <>
                    <ExternalLink
                      className="account-setup__funding-faucet"
                      href={usdcFaucet.faucet}
                    >
                      {usdcFaucet.linkLabel}
                    </ExternalLink>
                    {funds.walletStable === 0n && (
                      <p className="account-setup__funding-faucet-note">
                        {usdcFaucet.instructions}
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>
          </ul>
        )}
      </div>

      <div className="account-setup__section account-setup__stack">
        {errorNode}

        {plannedItems.length > 0 && (
          <section className="account-setup__review" aria-labelledby="funding-wallet-steps">
            <h2 id="funding-wallet-steps">Wallet steps</h2>
            <ol>
              {plannedItems.map((item) => (
                <li
                  key={item.id}
                  aria-current={depositing && activeItem === item.id ? 'step' : undefined}
                >
                  <span>{item.label}</span>
                  <small>{item.networkName}</small>
                </li>
              ))}
            </ol>
            <p id="funding-wallet-instructions" role={depositing ? 'status' : undefined}>
              {depositing
                ? 'Check your wallet for each confirmation. Confirmed deposits are saved automatically.'
                : 'Your wallet shows each deposit and its network fee in order.'}
            </p>
          </section>
        )}

        {allConfirmed && (
          <p role="status">
            {canAddMore
              ? 'Your deposits are confirmed. Continue when you’re ready, or add more funds above.'
              : 'Your deposits are confirmed. Continue when you’re ready.'}
          </p>
        )}

        <div className="account-setup__action account-setup__action--split">
          {allConfirmed ? (
            <Button
              ref={continueRef}
              variant="primary"
              className="account-setup__funding-continue"
              onClick={onComplete}
            >
              {continueLabel}
              <HugeiconsIcon icon={ArrowRight02Icon} size={17} aria-hidden="true" />
            </Button>
          ) : (
            <>
              {!depositing && (
                <Button onClick={onComplete}>
                  {confirmedCount > 0 ? continueLabel : 'Skip for now'}
                </Button>
              )}
              <Button
                variant="primary"
                disabled={
                  !connector || !funds || depositing || hasFieldError || plannedItems.length === 0
                }
                aria-describedby={
                  plannedItems.length > 0 ? 'funding-wallet-instructions' : undefined
                }
                onClick={() => {
                  if (!connector || !funds || plannedItems.length === 0) return;
                  deposit({ plan: plannedItems, connectorUid: connector.uid, funds });
                }}
              >
                {depositing && <Spinner />}
                {depositing
                  ? 'Depositing…'
                  : depositError
                    ? 'Retry remaining deposits'
                    : 'Deposit funds'}
                {!depositing && (
                  <HugeiconsIcon icon={ArrowRight02Icon} size={17} aria-hidden="true" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
