import {
  executionCreditAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  type Address,
} from '@rulebook/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  erc20Abi,
  formatEther,
  formatUnits,
  isHash,
  parseUnits,
  zeroAddress,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { writeContract } from 'viem/actions';
import { useAccount, useBalance, useConfig, useReadContract } from 'wagmi';
import { getConnectorClient } from 'wagmi/actions';

import { useChainGuard } from '../hooks/useChainGuard.js';
import { DEMO_USDC, LASNA_CONFIG, UNICHAIN_CONFIG } from '../lib/contracts.js';
import { costModel } from '../lib/costModel.js';
import { isRpcRateLimit } from '../lib/errors.js';
import { ruleFees, type RuleFee } from '../lib/funding.js';
import { appRoutes } from '../lib/routes.js';
import type { SignatureDetails } from '../lib/signatures.js';
import { testnetTokens } from '../lib/testnetTokens.js';
import { lasnaPublicClient, unichainPublicClient } from '../lib/wagmi.js';
import { ErrorState } from './ErrorState.js';
import { TxLink } from './TxLink.js';

export function TestnetFaucets() {
  return (
    <div className="space-y-3">
      <h2 className="app-panel-heading">Get test tokens</h2>
      <p className="app-copy">
        Use your connected wallet address. Get REACT for Lasna fees, ETH for Unichain Sepolia fees,
        and test USDC if your rule will buy or transfer.
      </p>
      <ul className="flex flex-wrap gap-2">
        {Object.values(testnetTokens).map(({ symbol, faucet, linkLabel }) => (
          <li key={symbol}>
            <a className="app-button" href={faucet} target="_blank" rel="noreferrer">
              {linkLabel}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useExecutionCredit(agent: Address, vault: Address) {
  const watching = useReadContract({
    address: LASNA_CONFIG.systemContract,
    abi: executionCreditAbi,
    functionName: 'reserves',
    args: [agent],
    chainId: LASNA_CHAIN_ID,
  });
  const execution = useReadContract({
    address: UNICHAIN_CONFIG.callbackProxy,
    abi: executionCreditAbi,
    functionName: 'reserves',
    args: [vault],
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
  });
  return { watching, execution };
}

type FundingChoice = RuleFee | 'vault';
type FundingTransaction = {
  hash: Hex;
  chainId: number;
  kind: 'approval' | 'deposit';
  awaitingFeeBalance?: true;
};

class FundingRateLimitError extends Error {
  constructor(cause: unknown) {
    super('Your wallet’s network provider is rate limiting transactions.', { cause });
  }
}

function readPendingFunding(key: string, chainId: number): FundingTransaction | undefined {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    if (
      typeof saved?.hash === 'string' &&
      isHash(saved.hash) &&
      (saved.kind === 'approval' || saved.kind === 'deposit')
    ) {
      return {
        hash: saved.hash,
        chainId,
        kind: saved.kind,
        ...(saved.kind === 'deposit' && saved.awaitingFeeBalance === true
          ? { awaitingFeeBalance: true }
          : {}),
      };
    }
  } catch {
    // Funding still works in the current view when storage is unavailable.
  }
}

function fundingEstimate(choice: FundingChoice, amount: bigint) {
  if (choice === 'vault' || amount <= 0n) return null;
  const { monitoringReactPerYear, ethPerSwap } = costModel.dailyDca;
  if (choice === 'execution') {
    const swaps = amount / parseUnits(ethPerSwap, 18);
    return swaps === 0n
      ? 'Below the measured fee for one testnet swap.'
      : `Estimated to cover ${swaps.toLocaleString()} ${swaps === 1n ? 'swap' : 'swaps'}.`;
  }
  const days = (amount * 365n) / parseUnits(monitoringReactPerYear, 18);
  const duration =
    days === 0n
      ? 'Less than one day'
      : `About ${days.toLocaleString()} ${days === 1n ? 'day' : 'days'}`;
  return `${duration} of monitoring for one daily buy.`;
}

export function AccountFunding({
  agent,
  vault,
  onConfirmed,
  onFeeConfirmed,
  guided,
  onProgressChange,
}: {
  agent: Address;
  vault: Address;
  onConfirmed?: () => void | Promise<void>;
  onFeeConfirmed?: (block: Pick<TransactionReceipt, 'blockHash' | 'blockNumber'>) => Promise<void>;
  guided?: {
    choice: FundingChoice;
    suggestedAmount?: string;
    debt?: bigint;
    onRefresh: () => Promise<void>;
  };
  onProgressChange?: (choice: FundingChoice, busy: boolean, checkingFee: boolean) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (!guided && hash === '#fund-account') section.current?.scrollIntoView();
  }, [guided, hash]);
  const [chosen, setChoice] = useState<FundingChoice>('watching');
  const queryClient = useQueryClient();
  const choice = guided?.choice ?? chosen;
  const options = {
    watching: {
      label: 'Rule monitoring fees',
      chainId: LASNA_CHAIN_ID,
      target: ruleFees.watching.target,
      beneficiary: agent,
      symbol: 'REACT',
      decimals: 18,
      client: lasnaPublicClient,
    },
    execution: {
      label: 'Rule execution fees',
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      target: ruleFees.execution.target,
      beneficiary: vault,
      symbol: 'ETH',
      decimals: 18,
      client: unichainPublicClient,
    },
    vault: {
      label: 'Vault funds for trades',
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      target: vault,
      beneficiary: vault,
      symbol: 'USDC',
      decimals: 6,
      client: unichainPublicClient,
    },
  } as const;
  const selected = options[choice];
  const isVault = choice === 'vault';
  const { address } = useAccount();
  const config = useConfig();
  const requestSignature = useChainGuard();
  const [enteredAmount, setAmount] = useState<string>();
  const [localSubmission, setLocalSubmission] = useState<{ key: string; tx: FundingTransaction }>();
  const pendingKey = address
    ? `rulebook:pending-funding:v1:${selected.chainId}:${address.toLowerCase()}:${choice}:${selected.beneficiary.toLowerCase()}`
    : undefined;
  const submitted = pendingKey
    ? localSubmission?.key === pendingKey
      ? localSubmission.tx
      : readPendingFunding(pendingKey, selected.chainId)
    : undefined;
  const updatingFeeBalance = Boolean(onFeeConfirmed && submitted?.awaitingFeeBalance);
  function rememberSubmission(key: string, tx?: FundingTransaction) {
    setLocalSubmission(tx ? { key, tx } : undefined);
    try {
      if (tx) window.localStorage.setItem(key, JSON.stringify(tx));
      else window.localStorage.removeItem(key);
    } catch {
      // Keep receipt rechecking available in memory when storage is blocked.
    }
  }
  const amount = enteredAmount ?? guided?.suggestedAmount ?? '';
  const balance = useBalance({
    address,
    chainId: selected.chainId,
    query: { enabled: !!address, refetchOnWindowFocus: 'always' },
  });
  const token = useReadContract({
    address: DEMO_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? zeroAddress],
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    query: { enabled: !!address && isVault, refetchOnWindowFocus: 'always' },
  });
  const parsed =
    /^\d{1,15}(?:\.\d+)?$/.test(amount) && (amount.split('.')[1]?.length ?? 0) <= selected.decimals
      ? parseUnits(amount, selected.decimals)
      : 0n;
  const sufficient =
    !balance.isError &&
    (!isVault || !token.isError) &&
    balance.data !== undefined &&
    balance.data.value > 0n &&
    (isVault ? token.data !== undefined && parsed <= token.data : parsed < balance.data.value);
  const estimate = fundingEstimate(choice, parsed - (guided?.debt ?? 0n));

  const deposit = useMutation({
    retry: false,
    mutationFn: async (retry?: FundingTransaction): Promise<FundingTransaction> => {
      if (!address || !pendingKey) throw new Error('Connect the wallet that started this deposit.');
      const key = pendingKey;
      const confirm = async (transaction: FundingTransaction) => {
        rememberSubmission(key, transaction);
        let replaced = false;
        const receipt = await selected.client.waitForTransactionReceipt({
          hash: transaction.hash,
          onReplaced: ({ reason }) => {
            replaced = reason !== 'repriced';
          },
        });
        if (replaced || receipt.status !== 'success') {
          rememberSubmission(key);
          throw new Error('The transaction was cancelled, replaced, or reverted.');
        }
        const confirmed = {
          hash: receipt.transactionHash,
          chainId: transaction.chainId,
          kind: transaction.kind,
        };
        if (transaction.kind === 'deposit' && onFeeConfirmed) {
          // Keep the submission locked and recoverable until the confirmed balance is available.
          rememberSubmission(key, { ...confirmed, awaitingFeeBalance: true });
          await onFeeConfirmed(receipt);
        }
        rememberSubmission(key);
        return confirmed;
      };
      if (retry) return confirm(retry);
      const broadcast = readPendingFunding(key, selected.chainId);
      if (broadcast) {
        setLocalSubmission({ key, tx: broadcast });
        throw new Error('Check the submitted transaction before adding funds again.');
      }
      if (parsed <= 0n || !sufficient)
        throw new Error(
          'Enter an amount your wallet can cover. Leave enough for the transaction fee.',
        );
      const requestFundingSignature = (
        details: SignatureDetails,
        send: (client: Awaited<ReturnType<typeof getConnectorClient>>) => Promise<Hex>,
      ) =>
        requestSignature(details, address, async (connector) => {
          const client = await getConnectorClient(config, {
            account: address,
            chainId: details.chainId,
            connector,
          });
          try {
            return await send({
              ...client,
              request: async (args, options) => {
                try {
                  return await client.request(args as never, options);
                } catch (error) {
                  // Viem can try another wallet method on generic invalid-input RPC codes.
                  // Surface a throttle before that fallback can submit the transfer again.
                  if (
                    (args.method === 'eth_sendTransaction' ||
                      args.method === 'wallet_sendTransaction') &&
                    isRpcRateLimit(error)
                  ) {
                    throw new FundingRateLimitError(error);
                  }
                  throw error;
                }
              },
            });
          } catch (error) {
            if (isRpcRateLimit(error)) throw new FundingRateLimitError(error);
            throw error;
          }
        });
      const display = `${formatUnits(parsed, selected.decimals)} test ${selected.symbol}`;
      let hash: Hex;
      if (isVault) {
        const allowance = await unichainPublicClient.readContract({
          address: DEMO_USDC,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, vault],
        });
        if (allowance < parsed) {
          const approval = await requestFundingSignature(
            {
              chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
              target: DEMO_USDC,
              targetLabel: 'Test USDC',
              effect: 'Approve this exact deposit into your vault.',
              amount: display,
            },
            (client) =>
              writeContract(client, {
                account: address,
                address: DEMO_USDC,
                abi: erc20Abi,
                functionName: 'approve',
                args: [vault, parsed],
              }),
          );
          await confirm({ chainId: selected.chainId, hash: approval, kind: 'approval' });
        }
        hash = await requestFundingSignature(
          {
            chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
            target: vault,
            targetLabel: 'Your vault',
            effect: 'Add funds your rules can use for trades or transfers.',
            amount: display,
          },
          (client) =>
            writeContract(client, {
              account: address,
              address: vault,
              abi: vaultAbi,
              functionName: 'deposit',
              args: [DEMO_USDC, parsed],
            }),
        );
      } else {
        hash = await requestFundingSignature(
          {
            chainId: selected.chainId,
            target: selected.target,
            targetLabel: 'Network fee contract',
            effect: `Add ${selected.label.toLowerCase()} to your Rulebook account.`,
            amount: display,
            amountLabel: 'Fee top-up',
          },
          (client) =>
            writeContract(client, {
              account: address,
              address: selected.target,
              abi: executionCreditAbi,
              functionName: 'depositTo',
              args: [selected.beneficiary],
              value: parsed,
              ...(selected.chainId === LASNA_CHAIN_ID ? { maxPriorityFeePerGas: 1n } : {}),
            }),
        );
      }
      return confirm({ hash, chainId: selected.chainId, kind: 'deposit' });
    },
    onSuccess: async ({ kind }) => {
      if (kind === 'approval') return;
      if (onFeeConfirmed) void balance.refetch();
      else await Promise.all([balance.refetch(), isVault && token.refetch(), onConfirmed?.()]);
      setAmount(guided ? undefined : '');
      void queryClient.invalidateQueries({
        predicate: ({ queryKey: [type, account] }) =>
          (type === 'sponsor' || type === 'rule') &&
          typeof account === 'string' &&
          account.toLowerCase() === agent.toLowerCase(),
      });
    },
  });
  const locked = deposit.isPending || !!submitted;
  useEffect(() => {
    onProgressChange?.(choice, deposit.isPending, updatingFeeBalance);
  }, [choice, deposit.isPending, onProgressChange, updatingFeeBalance]);

  const fundingToken = isVault ? testnetTokens.usdc : ruleFees[choice].token;
  const heading = guided ? (isVault ? 'Vault USDC' : ruleFees[choice].title) : 'Fund your account';
  const balanceError = balance.isError || (isVault && token.isError);
  const submit = (
    <button
      type="submit"
      className="app-button app-button--primary"
      disabled={!address || !sufficient || parsed <= 0n || locked}
    >
      {deposit.isPending
        ? 'Waiting for confirmation…'
        : isVault
          ? 'Deposit USDC'
          : guided
            ? `Add ${selected.symbol}`
            : 'Add network fees'}
    </button>
  );

  return (
    <section
      ref={section}
      className={guided ? 'account-setup__section space-y-3' : 'app-panel app-panel-pad space-y-4'}
      id={guided ? undefined : 'fund-account'}
      aria-label={heading}
    >
      <header className="space-y-1">
        <h2 className="app-panel-heading" tabIndex={guided ? -1 : undefined}>
          {heading}
        </h2>
        {guided ? (
          <p>
            {fundingToken.network.name} ·{' '}
            {isVault ? 'Deposit USDC if your first rule spends it.' : ruleFees[choice].description}
          </p>
        ) : (
          <p className="app-copy">
            Add REACT to monitor your rules and ETH to carry out trades and transfers. Add USDC to
            your vault if your rule spends it.
          </p>
        )}
      </header>
      {updatingFeeBalance && submitted && (
        <div className="space-y-3">
          <p role="status" className="app-copy">
            {deposit.isPending
              ? 'Deposit confirmed. Updating your fee balance…'
              : 'Deposit confirmed. The fee balance is taking longer to update.'}{' '}
            <TxLink chainId={submitted.chainId} txHash={submitted.hash} label="View transaction" />
          </p>
          {!deposit.isPending && (
            <button
              type="button"
              className="app-button app-button--primary"
              onClick={() => deposit.mutate(submitted)}
            >
              Check fee balance
            </button>
          )}
        </div>
      )}
      <form
        hidden={updatingFeeBalance}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed > 0n && sufficient && !locked) deposit.mutate(undefined);
        }}
      >
        <div className={guided ? 'flex flex-wrap items-end gap-3' : 'app-form-grid'}>
          {!guided && (
            <label className="app-field">
              Fund with
              <select
                className="app-input"
                value={choice}
                disabled={locked}
                onChange={(event) => {
                  setChoice(event.target.value as keyof typeof options);
                  setAmount('');
                  deposit.reset();
                }}
              >
                <option value="watching">REACT · Reactive Lasna monitoring</option>
                <option value="execution">ETH · Unichain Sepolia execution</option>
                <option value="vault">USDC · Unichain Sepolia vault</option>
              </select>
            </label>
          )}
          <label className="app-field">
            Amount ({selected.symbol})
            <input
              className="app-input"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              disabled={locked}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          {guided && submit}
        </div>
        {balanceError ? (
          <ErrorState
            message="Your wallet balance could not be checked."
            onRetry={() => void Promise.all([balance.refetch(), isVault && token.refetch()])}
          />
        ) : balance.data && (!isVault || token.data !== undefined) ? (
          <p className="app-copy">
            In your wallet: {formatEther(balance.data.value)} {isVault ? 'ETH' : selected.symbol}
            {isVault && token.data !== undefined ? ` and ${formatUnits(token.data, 6)} USDC` : ''}.
            Keep some native tokens for wallet fees.
          </p>
        ) : (
          <p role="status" className="app-copy">
            Checking wallet balance…
          </p>
        )}
        {amount && parsed <= 0n && (
          <p className="app-copy">
            Enter an amount above zero with up to {selected.decimals} decimal places.
          </p>
        )}
        {amount && parsed > 0n && balance.data && !balanceError && !sufficient && (
          <p className="app-copy">
            Enter a smaller amount or get more test tokens. Leave enough for the wallet fee.
          </p>
        )}
        {estimate && sufficient && (
          <p className="app-copy">
            {estimate}{' '}
            <Link to={appRoutes.cost} className="app-link" target="_blank" rel="noreferrer">
              See fee estimates
            </Link>
          </p>
        )}
        {!guided && <div className="app-form-actions">{submit}</div>}
      </form>
      {deposit.error &&
        !submitted &&
        (deposit.error instanceof FundingRateLimitError ? (
          <ErrorState message={deposit.error.message} chainId={selected.chainId}>
            <p className="mt-2 app-copy">
              Check your wallet activity for this transaction before trying again. If the limit
              persists, switch to another RPC provider for this network in your wallet settings.
            </p>
            {selected.chainId === UNICHAIN_SEPOLIA_CHAIN_ID && (
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                <a
                  className="app-link"
                  href="https://support.metamask.com/configure/networks/how-to-add-a-custom-network-rpc/#adding-or-editing-rpc-urls"
                  target="_blank"
                  rel="noreferrer"
                >
                  Change RPC in MetaMask
                </a>
                <a
                  className="app-link"
                  href="https://developers.uniswap.org/docs/unichain/tools/node-providers"
                  target="_blank"
                  rel="noreferrer"
                >
                  Unichain RPC providers
                </a>
              </p>
            )}
          </ErrorState>
        ) : (
          <ErrorState
            message="The deposit could not be completed."
            detail={deposit.error.message}
          />
        ))}
      {submitted && !updatingFeeBalance && (
        <div className="space-y-2">
          <p role="status" className="app-copy">
            {deposit.isPending
              ? 'Transaction submitted.'
              : 'Check the submitted transaction before adding funds again.'}{' '}
            <TxLink chainId={submitted.chainId} txHash={submitted.hash} label="View transaction" />
          </p>
          {!deposit.isPending && (
            <button type="button" className="app-button" onClick={() => deposit.mutate(submitted)}>
              Check transaction
            </button>
          )}
        </div>
      )}
      {deposit.data && (
        <p role="status" className="app-copy">
          {deposit.data.kind === 'approval'
            ? 'Approval confirmed. Select Deposit USDC to finish.'
            : 'Deposit confirmed.'}{' '}
          <TxLink
            chainId={deposit.data.chainId}
            txHash={deposit.data.hash}
            label="View transaction"
          />
        </p>
      )}
      {guided && !updatingFeeBalance && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <a className="app-link" href={fundingToken.faucet} target="_blank" rel="noreferrer">
            {fundingToken.linkLabel}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <button
            type="button"
            className="app-link"
            disabled={locked}
            onClick={() =>
              void Promise.all([balance.refetch(), isVault && token.refetch(), guided.onRefresh()])
            }
          >
            Check balances
          </button>
        </p>
      )}
      {!guided && (
        <details className="space-y-3">
          <summary className="app-link cursor-pointer text-sm">Need more test tokens?</summary>
          <TestnetFaucets />
        </details>
      )}
    </section>
  );
}
