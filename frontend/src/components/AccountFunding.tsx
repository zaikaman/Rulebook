import {
  executionCreditAbi,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  type Address,
} from '@rulebook/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { erc20Abi, formatEther, formatUnits, parseUnits, zeroAddress, type Hex } from 'viem';
import { useAccount, useBalance, useReadContract, useWriteContract } from 'wagmi';

import { useChainGuard } from '../hooks/useChainGuard.js';
import { DEMO_USDC, LASNA_CONFIG, UNICHAIN_CONFIG } from '../lib/contracts.js';
import { costModel } from '../lib/costModel.js';
import { appRoutes } from '../lib/routes.js';
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
        <li>
          <a
            className="app-button"
            href="https://dev.reactive.network/reactive-mainnet#reactive-faucet"
            target="_blank"
            rel="noreferrer"
          >
            Get Lasna REACT
          </a>
        </li>
        <li>
          <a
            className="app-button"
            href="https://console.optimism.io/faucet"
            target="_blank"
            rel="noreferrer"
          >
            Get Unichain Sepolia ETH
          </a>
        </li>
        <li>
          <a
            className="app-button"
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noreferrer"
          >
            Get Unichain Sepolia USDC
          </a>
        </li>
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

type FundingChoice = 'watching' | 'execution' | 'vault';

function fundingEstimate(choice: FundingChoice, amount: bigint) {
  if (choice === 'vault' || amount === 0n) return null;
  const { monitoringReactPerYear, ethPerSwap } = costModel.dailyDca;
  const days =
    choice === 'watching'
      ? (amount * 365n) / parseUnits(monitoringReactPerYear, 18)
      : amount / parseUnits(ethPerSwap, 18);
  const duration =
    days === 0n
      ? 'Less than one day'
      : `About ${days.toLocaleString()} ${days === 1n ? 'day' : 'days'}`;
  const activity = choice === 'watching' ? 'of monitoring' : 'of swap fees';
  return `${duration} ${activity} for one daily buy, based on measured testnet fees.`;
}

export function AccountFunding({
  agent,
  vault,
  onConfirmed,
  suggested,
}: {
  agent: Address;
  vault: Address;
  onConfirmed?: () => void;
  suggested?: FundingChoice;
}) {
  const section = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#fund-account') section.current?.scrollIntoView();
  }, [hash]);
  const [chosen, setChoice] = useState<FundingChoice>();
  const choice = chosen ?? suggested ?? 'watching';
  const options = {
    watching: {
      label: 'Rule monitoring fees',
      chainId: LASNA_CHAIN_ID,
      target: LASNA_CONFIG.systemContract,
      beneficiary: agent,
      symbol: 'REACT',
      decimals: 18,
      client: lasnaPublicClient,
    },
    execution: {
      label: 'Rule execution fees',
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      target: UNICHAIN_CONFIG.callbackProxy,
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
  const { writeContractAsync } = useWriteContract();
  const requestSignature = useChainGuard();
  const [amount, setAmount] = useState('');
  const balance = useBalance({ address, chainId: selected.chainId, query: { enabled: !!address } });
  const token = useReadContract({
    address: DEMO_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? zeroAddress],
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    query: { enabled: !!address && isVault },
  });
  const parsed =
    /^\d{1,15}(?:\.\d+)?$/.test(amount) && (amount.split('.')[1]?.length ?? 0) <= selected.decimals
      ? parseUnits(amount, selected.decimals)
      : 0n;
  const sufficient =
    balance.data !== undefined &&
    balance.data.value > 0n &&
    (isVault ? token.data !== undefined && parsed <= token.data : parsed < balance.data.value);
  const estimate = fundingEstimate(choice, parsed);

  const deposit = useMutation({
    mutationFn: async () => {
      if (!address || parsed <= 0n || !sufficient)
        throw new Error(
          'Enter an amount your wallet can cover. Leave enough for the transaction fee.',
        );
      const display = `${formatUnits(parsed, selected.decimals)} test ${selected.symbol}`;
      const confirm = async (hash: Hex) => {
        const receipt = await selected.client.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error('The transaction did not complete.');
      };
      let hash: Hex;
      if (isVault) {
        const allowance = await unichainPublicClient.readContract({
          address: DEMO_USDC,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, vault],
        });
        if (allowance < parsed) {
          const approval = await requestSignature(
            {
              chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
              target: DEMO_USDC,
              targetLabel: 'Test USDC',
              effect: 'Approve this exact deposit into your vault.',
              amount: display,
            },
            address,
            () =>
              writeContractAsync({
                account: address,
                address: DEMO_USDC,
                chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
                abi: erc20Abi,
                functionName: 'approve',
                args: [vault, parsed],
              }),
          );
          await confirm(approval);
        }
        hash = await requestSignature(
          {
            chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
            target: vault,
            targetLabel: 'Your vault',
            effect: 'Add funds your rules can use for trades or transfers.',
            amount: display,
          },
          address,
          () =>
            writeContractAsync({
              account: address,
              address: vault,
              chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
              abi: vaultAbi,
              functionName: 'deposit',
              args: [DEMO_USDC, parsed],
            }),
        );
      } else {
        hash = await requestSignature(
          {
            chainId: selected.chainId,
            target: selected.target,
            targetLabel: 'Network fee contract',
            effect: `Add ${selected.label.toLowerCase()} to your Rulebook account.`,
            amount: display,
            amountLabel: 'Fee top-up',
          },
          address,
          () =>
            writeContractAsync({
              account: address,
              address: selected.target,
              chainId: selected.chainId,
              abi: executionCreditAbi,
              functionName: 'depositTo',
              args: [selected.beneficiary],
              value: parsed,
              ...(selected.chainId === LASNA_CHAIN_ID ? { maxPriorityFeePerGas: 1n } : {}),
            }),
        );
      }
      await confirm(hash);
      return { hash, chainId: selected.chainId };
    },
    onSuccess: () => {
      setAmount('');
      if (suggested) setChoice(undefined);
      void balance.refetch();
      if (isVault) void token.refetch();
      onConfirmed?.();
    },
  });

  return (
    <section
      ref={section}
      className="app-panel app-panel-pad space-y-4"
      id="fund-account"
      aria-label="Fund your account"
    >
      <header className="space-y-1">
        <h2 className="app-panel-heading">Fund your account</h2>
        <p className="app-copy">
          Add REACT to monitor your rules and ETH to carry out trades and transfers. Add USDC to
          your vault if your rule spends it.
        </p>
      </header>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed > 0n && sufficient && !deposit.isPending) deposit.mutate();
        }}
      >
        <div className="flex flex-wrap gap-3">
          <label className="app-field">
            Fund with
            <select
              className="app-input"
              value={choice}
              disabled={deposit.isPending}
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
          <label className="app-field">
            Amount ({selected.symbol})
            <input
              className="app-input"
              inputMode="decimal"
              value={amount}
              disabled={deposit.isPending}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
        </div>
        {balance.data && (
          <p className="app-copy">
            In your wallet: {formatEther(balance.data.value)} {isVault ? 'ETH' : selected.symbol}
            {isVault && token.data !== undefined ? ` and ${formatUnits(token.data, 6)} USDC` : ''}.
            Keep some native tokens for wallet fees.
          </p>
        )}
        {amount && parsed > 0n && balance.data && !sufficient && (
          <p className="app-copy">Your wallet needs more test tokens for this amount.</p>
        )}
        {estimate && sufficient && (
          <p className="app-copy">
            {estimate}{' '}
            <Link to={appRoutes.cost} className="app-link" target="_blank" rel="noreferrer">
              See fee estimates
            </Link>
          </p>
        )}
        <button
          type="submit"
          className="app-button app-button--primary"
          disabled={!address || !sufficient || parsed <= 0n || deposit.isPending}
        >
          {deposit.isPending
            ? 'Waiting for confirmation…'
            : isVault
              ? 'Deposit USDC'
              : 'Add network fees'}
        </button>
      </form>
      {deposit.error && (
        <ErrorState message="The deposit could not be completed." detail={deposit.error.message} />
      )}
      {deposit.data && (
        <p role="status" className="app-copy">
          Deposit confirmed.{' '}
          <TxLink chainId={deposit.data.chainId} txHash={deposit.data.hash} label="View deposit" />
        </p>
      )}
      <details className="space-y-3">
        <summary className="app-link cursor-pointer text-sm">Need more test tokens?</summary>
        <TestnetFaucets />
      </details>
    </section>
  );
}
