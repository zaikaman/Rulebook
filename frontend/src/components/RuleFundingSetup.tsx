import { ArrowRight02Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { executionCreditAbi, feeCreditWarningThreshold, type Address } from '@rulebook/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatEther, parseEther, type TransactionReceipt } from 'viem';

import { costModel } from '../lib/costModel.js';
import { ruleFees, type RuleFee } from '../lib/funding.js';
import { appRoutes } from '../lib/routes.js';
import { roundUpFee } from '../lib/setupFees.js';
import { lasnaPublicClient, unichainPublicClient } from '../lib/wagmi.js';
import { AccountFunding } from './AccountFunding.js';
import { ACCOUNT_SETUP_STEPS, AccountSetupFrame } from './AccountSetupFrame.js';
import { ErrorState } from './ErrorState.js';

const setupFees = ['watching', 'execution'] as const;

function feeClient(fee: RuleFee) {
  return fee === 'watching' ? lasnaPublicClient : unichainPublicClient;
}

async function readFeeBalance(
  fee: RuleFee,
  beneficiary: Address,
  { blockNumber, blockHash }: { blockNumber: bigint; blockHash?: TransactionReceipt['blockHash'] },
  signal: AbortSignal,
) {
  const client = feeClient(fee).scope({ signal });
  const block = blockHash ? { blockHash, requireCanonical: true as const } : { blockNumber };
  const contract = {
    address: ruleFees[fee].target,
    abi: executionCreditAbi,
    args: [beneficiary],
    ...block,
  } as const;
  const [balance, debt] = await Promise.all([
    client.readContract({ ...contract, functionName: 'reserves' }),
    client.readContract({ ...contract, functionName: 'debt' }),
  ]);
  return { balance, debt, blockNumber };
}

function feeBalanceOptions(fee: RuleFee, beneficiary: Address) {
  return queryOptions({
    queryKey: ['feeBalance', fee, beneficiary.toLowerCase()] as const,
    queryFn: async ({ client, queryKey, signal }) => {
      const head = await feeClient(fee).scope({ signal }).getBlockNumber({ cacheTime: 0 });
      const previous = client.getQueryData<Awaited<ReturnType<typeof readFeeBalance>>>(queryKey);
      // An RPC answering from an older head cannot replace a newer verified balance.
      if (previous && previous.blockNumber > head) return previous;
      return readFeeBalance(fee, beneficiary, { blockNumber: head }, signal);
    },
  });
}

function recommendedDeposit(fee: RuleFee, balance: bigint, debt: bigint) {
  const minimum = feeCreditWarningThreshold(ruleFees[fee].token.network.chainId);
  const dailyMonitoring = parseEther(costModel.dailyDca.monitoringReactPerYear) / 365n;
  const target = fee === 'watching' && dailyMonitoring > minimum ? dailyMonitoring : minimum;
  const deposit = debt + (balance < target ? target - balance : 0n);
  return deposit > 0n ? formatEther(roundUpFee(deposit)) : undefined;
}

export function RuleFundingSetup({
  agent,
  vault,
  fee,
  onCompose,
}: {
  agent: Address;
  vault: Address;
  fee?: RuleFee;
  onCompose: () => void;
}) {
  const queryClient = useQueryClient();
  const feeOptions = {
    watching: feeBalanceOptions('watching', agent),
    execution: feeBalanceOptions('execution', vault),
  };
  const watching = useQuery({ ...feeOptions.watching, enabled: !fee || fee === 'watching' });
  const execution = useQuery({ ...feeOptions.execution, enabled: !fee || fee === 'execution' });
  const feeBalances = { watching, execution };
  const [progress, setProgress] = useState<{
    choice: RuleFee | 'vault';
    busy: boolean;
    checkingFee: boolean;
  }>();
  const onProgressChange = useCallback(
    (choice: RuleFee | 'vault', busy: boolean, checkingFee: boolean) => {
      setProgress(busy || checkingFee ? { choice, busy, checkingFee } : undefined);
    },
    [],
  );
  const fees = fee ? [fee] : setupFees;
  const balances = fees.map((key) => {
    if (progress?.choice === key && progress.checkingFee) {
      return { key, status: progress.busy ? 'Updating balance' : 'Deposit confirmed' };
    }
    const { data, isError } = feeBalances[key];
    if (isError) {
      return { key, status: 'Unavailable' };
    }
    if (!data) {
      return { key, status: 'Checking…' };
    }
    const { balance, debt } = data;
    const minimum = feeCreditWarningThreshold(ruleFees[key].token.network.chainId);
    const status = debt > 0n ? 'Fees due' : balance >= minimum ? 'Funded' : 'Top up needed';
    return { key, balance, debt, status };
  });
  const funded = balances.every(({ status }) => status === 'Funded');
  const nextFee = balances.find(({ status }) => status !== 'Funded' && status !== 'Unavailable');
  const activeFee = nextFee?.balance === undefined ? undefined : nextFee;
  const requestedFee = fee && balances.find(({ balance }) => balance !== undefined);
  const [showVault, setShowVault] = useState(false);
  const choice =
    progress?.choice ??
    (requestedFee || activeFee)?.key ??
    (funded && showVault ? 'vault' : undefined);
  const formArea = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLButtonElement>(null);
  const previousChoice = useRef(choice);
  useEffect(() => {
    const previous = previousChoice.current;
    previousChoice.current = choice;
    if (!previous || previous === choice) return;
    if (choice) formArea.current?.querySelector('h2')?.focus();
    else footer.current?.focus();
  }, [choice]);

  const refresh = async () => {
    await Promise.all(fees.map((key) => feeBalances[key].refetch()));
  };
  async function reconcileFee(
    key: RuleFee,
    block: Pick<TransactionReceipt, 'blockHash' | 'blockNumber'>,
  ) {
    const { queryKey } = feeOptions[key];
    const beneficiary = key === 'watching' ? agent : vault;
    const confirmed = await queryClient.fetchQuery({
      queryKey: [...queryKey, 'receipt', block.blockHash],
      // Cap each attempt, including transport retries, so recovery stays reachable on a slow RPC.
      queryFn: () => readFeeBalance(key, beneficiary, block, AbortSignal.timeout(8_000)),
      networkMode: 'always',
      retry: 2,
    });
    // Prevent an in-flight refetch started before the receipt from publishing an older result.
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData(queryKey, (previous) =>
      previous && previous.blockNumber > confirmed.blockNumber ? previous : confirmed,
    );
  }
  const current = choice && choice !== 'vault' ? feeBalances[choice].data : undefined;
  const suggestedAmount =
    current && choice && choice !== 'vault'
      ? recommendedDeposit(choice, current.balance, current.debt)
      : undefined;

  return (
    <AccountSetupFrame
      title={fee ? `Add ${ruleFees[fee].title.toLowerCase()}` : 'Fund your account'}
      description={
        fee
          ? 'Top up this fee balance directly from your testnet wallet.'
          : 'Add the testnet fees your rules need to run.'
      }
      step={fee ? undefined : ACCOUNT_SETUP_STEPS}
      connected
      focusOnMount
      compact
    >
      <section className="app-panel" aria-labelledby="account-setup-title">
        <div className="account-setup__section">
          <ul className="account-setup__fees" aria-label="Rule fee balances">
            {balances.map(({ key, status, balance, debt }) => {
              const { title, token } = ruleFees[key];
              const hasCredit = status === 'Funded';
              return (
                <li
                  key={key}
                  aria-current={choice === key ? 'step' : undefined}
                  data-network={token.network.role}
                >
                  <span className="account-setup__network-dot" aria-hidden="true" />
                  <div>
                    <strong>{title}</strong>
                    <p>
                      Test {token.symbol} · {token.network.name}
                    </p>
                  </div>
                  <div className="account-setup__token-status">
                    <span
                      className="account-setup__status"
                      data-tone={hasCredit ? 'positive' : 'neutral'}
                    >
                      {hasCredit && (
                        <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden="true" />
                      )}
                      {status}
                    </span>
                    {balance !== undefined && (
                      <code>
                        {formatEther(balance)} {token.symbol}
                      </code>
                    )}
                  </div>
                  {debt !== undefined && debt > 0n && (
                    <p className="account-setup__fee-debt">
                      Outstanding fees of {formatEther(debt)} {token.symbol} are paid first.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {balances.some(({ status }) => status === 'Unavailable') && (
            <ErrorState
              message="Fee balances could not be checked."
              onRetry={() => void refresh()}
            />
          )}
        </div>

        {choice && (
          <div className="account-setup__funding-form" ref={formArea}>
            <AccountFunding
              key={choice}
              agent={agent}
              vault={vault}
              guided={{ choice, suggestedAmount, debt: current?.debt, onRefresh: refresh }}
              onFeeConfirmed={
                choice === 'vault' ? undefined : (block) => reconcileFee(choice, block)
              }
              onProgressChange={onProgressChange}
            />
          </div>
        )}
        <div className="account-setup__section account-setup__funding-footer">
          {fee ? (
            <Link to={appRoutes.account} className="app-link">
              View account balances
            </Link>
          ) : (
            <>
              {funded ? (
                <>
                  <div>
                    <h2>Your rule fees are funded</h2>
                    <p>Add test USDC if your first rule will spend it.</p>
                  </div>
                  <button
                    type="button"
                    className="app-button"
                    disabled={progress?.busy}
                    aria-expanded={showVault}
                    onClick={() => setShowVault((show) => !show)}
                  >
                    {showVault ? 'Hide USDC deposit' : 'Add optional USDC'}
                  </button>
                </>
              ) : !progress?.busy ? (
                <p>You can still create a rule and add fees before you expect it to run.</p>
              ) : null}
              <button
                ref={footer}
                type="button"
                className={funded ? 'app-button app-button--primary' : 'app-link'}
                disabled={progress?.busy}
                onClick={onCompose}
              >
                {funded ? 'Compose your first rule' : 'Compose and fund later'}
                {funded && <HugeiconsIcon icon={ArrowRight02Icon} size={17} aria-hidden="true" />}
              </button>
            </>
          )}
        </div>
      </section>
    </AccountSetupFrame>
  );
}
