import { ArrowRight02Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { executionCreditAbi, feeCreditWarningThreshold, type Address } from '@rulebook/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatEther, parseEther } from 'viem';
import { useReadContract } from 'wagmi';

import { costModel } from '../lib/costModel.js';
import { ruleFees, type RuleFee } from '../lib/funding.js';
import { appRoutes } from '../lib/routes.js';
import { roundUpFee } from '../lib/setupFees.js';
import { AccountFunding, useExecutionCredit } from './AccountFunding.js';
import { ACCOUNT_SETUP_STEPS, AccountSetupFrame } from './AccountSetupFrame.js';
import { ErrorState } from './ErrorState.js';

const setupFees = ['watching', 'execution'] as const;

function useFeeDebt(fee: RuleFee, beneficiary: Address) {
  const { target, token } = ruleFees[fee];
  return useReadContract({
    address: target,
    abi: executionCreditAbi,
    functionName: 'debt',
    args: [beneficiary],
    chainId: token.network.chainId,
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
  const credits = useExecutionCredit(agent, vault);
  const watchingDebt = useFeeDebt('watching', agent);
  const executionDebt = useFeeDebt('execution', vault);
  const debts = { watching: watchingDebt, execution: executionDebt };
  const fees = fee ? [fee] : setupFees;
  const balances = fees.map((key) => {
    const balance = credits[key].data;
    const debt = debts[key].data;
    if (credits[key].isError || debts[key].isError) {
      return { key, status: 'Unavailable' };
    }
    if (balance === undefined || debt === undefined) {
      return { key, status: 'Checking…' };
    }
    const minimum = feeCreditWarningThreshold(ruleFees[key].token.network.chainId);
    const status = debt > 0n ? 'Fees due' : balance >= minimum ? 'Funded' : 'Top up needed';
    return { key, balance, debt, status };
  });
  const funded = balances.every(({ status }) => status === 'Funded');
  const nextFee = balances.find(({ status }) => status !== 'Funded' && status !== 'Unavailable');
  const activeFee = nextFee?.balance === undefined ? undefined : nextFee;
  const requestedFee = fee && balances.find(({ balance }) => balance !== undefined);
  const [showVault, setShowVault] = useState(false);
  const [busyChoice, setBusyChoice] = useState<RuleFee | 'vault'>();
  const choice =
    busyChoice ?? (requestedFee || activeFee)?.key ?? (funded && showVault ? 'vault' : undefined);
  const onBusyChange = useCallback(
    (busy: boolean) => {
      setBusyChoice(busy ? choice : undefined);
    },
    [choice],
  );
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
    await Promise.all(fees.flatMap((key) => [credits[key].refetch(), debts[key].refetch()]));
  };
  const current = balances.find(({ key }) => key === choice);
  const suggestedAmount =
    current?.balance !== undefined && current.debt !== undefined
      ? recommendedDeposit(current.key, current.balance, current.debt)
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
              guided={{ choice, suggestedAmount, debt: current?.debt }}
              onConfirmed={refresh}
              onBusyChange={onBusyChange}
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
                    disabled={!!busyChoice}
                    aria-expanded={showVault}
                    onClick={() => setShowVault((show) => !show)}
                  >
                    {showVault ? 'Hide USDC deposit' : 'Add optional USDC'}
                  </button>
                </>
              ) : (
                <p>You can still create a rule and add fees before you expect it to run.</p>
              )}
              <button
                ref={footer}
                type="button"
                className={funded ? 'app-button app-button--primary' : 'app-link'}
                disabled={!!busyChoice}
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
