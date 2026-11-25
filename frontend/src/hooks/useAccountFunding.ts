import {
  feeCreditWarningThreshold,
  getChain,
  LASNA_CHAIN_ID,
  readAmount,
  type Address,
  type FundsChainId,
} from '@rulebook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { formatUnits, parseEther, zeroAddress, type Hex } from 'viem';

export type SetupFundingItemId = 'watching' | 'execution' | 'usdc';

export interface SetupFundingBalances {
  readonly agent: Address;
  readonly vault: Address;
  readonly proxy?: Address;
  readonly lasnaSystem: Address;
  readonly usdc: Address;
  readonly watch: bigint;
  readonly execution: bigint;
  readonly stable: bigint;
  readonly walletWatch: bigint;
  readonly walletNative: bigint;
  readonly walletStable: bigint;
}

export interface SetupFundingWallet {
  readFunds(owner: Address, chain: FundsChainId): Promise<SetupFundingBalances>;
  depositWatchingCredit(
    owner: Address,
    agent: Address,
    systemContract: Address,
    amount: bigint,
    reviewedConnector: string,
  ): Promise<Hex>;
  depositExecutionCredit(
    owner: Address,
    vault: Address,
    proxy: Address,
    chain: FundsChainId,
    amount: bigint,
    reviewedConnector: string,
  ): Promise<Hex>;
  depositUsdc(
    owner: Address,
    vault: Address,
    usdc: Address,
    chain: FundsChainId,
    amount: bigint,
    reviewedConnector: string,
  ): Promise<Hex>;
}

export interface FundingPlanItem {
  readonly id: SetupFundingItemId;
  readonly amount: bigint;
  readonly display: string;
  readonly chainId: number;
  readonly label: string;
  readonly networkName: string;
}

export const SUGGESTED_WATCHING_CREDIT = parseEther('0.1');
export const SUGGESTED_EXECUTION_CREDIT = parseEther('0.001');
export const SUGGESTED_VAULT_USDC = 10_000_000n;
export const LASNA_GAS_BUFFER = parseEther('0.005');
export const FUNDS_GAS_BUFFER = parseEther('0.0002');

export function exactUnits(value: bigint, decimals: number): string {
  const [whole = '0', fraction] = formatUnits(value, decimals).split('.');
  if (!fraction) return whole;
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function suggestedCreditAmount(
  reserve: bigint,
  walletBalance: bigint,
  suggested: bigint,
  minimum: bigint,
  gasBuffer: bigint,
): string {
  if (reserve >= minimum) return '';
  const safe = walletBalance > gasBuffer ? walletBalance - gasBuffer : 0n;
  if (safe >= suggested) return exactUnits(suggested, 18);
  if (safe >= minimum) return exactUnits(minimum, 18);
  return '';
}

export function defaultFundingAmounts(
  funds: SetupFundingBalances,
  chainId: FundsChainId,
): Record<SetupFundingItemId, string> {
  const watching = suggestedCreditAmount(
    funds.watch,
    funds.walletWatch,
    SUGGESTED_WATCHING_CREDIT,
    feeCreditWarningThreshold(LASNA_CHAIN_ID),
    LASNA_GAS_BUFFER,
  );
  const execution =
    !funds.proxy || funds.proxy === zeroAddress
      ? ''
      : suggestedCreditAmount(
          funds.execution,
          funds.walletNative,
          SUGGESTED_EXECUTION_CREDIT,
          feeCreditWarningThreshold(chainId),
          FUNDS_GAS_BUFFER,
        );
  let usdc = '';
  if (funds.usdc !== zeroAddress && funds.stable === 0n && funds.walletStable > 0n) {
    usdc =
      funds.walletStable >= SUGGESTED_VAULT_USDC
        ? exactUnits(SUGGESTED_VAULT_USDC, 6)
        : exactUnits(funds.walletStable, 6);
  }
  return { watching, execution, usdc };
}

export function parseFundingAmount(
  raw: string,
  decimals: number,
  unit: string,
  maxBalance?: bigint,
): { amount?: bigint; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const amount = readAmount(trimmed, decimals, 'amount');
    if (amount === 0n) {
      return { error: 'Enter a positive amount or leave blank to skip.' };
    }
    if (maxBalance !== undefined && amount > maxBalance) {
      return { error: `You can use at most ${exactUnits(maxBalance, decimals)} ${unit}.` };
    }
    return { amount };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'Enter a valid amount.' };
  }
}

export function useAccountFunding({
  owner,
  chainId,
  fundingWallet,
}: {
  owner?: Address;
  chainId: FundsChainId;
  fundingWallet: SetupFundingWallet;
}) {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState<Partial<Record<SetupFundingItemId, Hex>>>({});
  const [activeItem, setActiveItem] = useState<SetupFundingItemId>();
  const [failedItem, setFailedItem] = useState<SetupFundingItemId>();
  const confirmedRef = useRef<Partial<Record<SetupFundingItemId, Hex>>>({});
  const runGenerationRef = useRef(0);

  const fundsQuery = useQuery({
    queryKey: ['workflow-v2', 'funding', owner, chainId],
    enabled: Boolean(owner),
    queryFn: () => fundingWallet.readFunds(owner!, chainId),
    refetchInterval: 12_000,
    retry: 1,
  });

  const deposit = useMutation({
    mutationKey: ['wallet-setup-funding', owner, chainId],
    retry: false,
    mutationFn: async ({
      plan,
      connectorUid,
      funds,
    }: {
      plan: readonly FundingPlanItem[];
      connectorUid: string;
      funds: SetupFundingBalances;
    }) => {
      if (!owner) throw new Error('Connect your wallet to fund your account.');
      const runId = runGenerationRef.current;
      setFailedItem(undefined);
      const lasnaName = getChain(LASNA_CHAIN_ID).name;
      for (const item of plan) {
        if (runGenerationRef.current !== runId) return confirmedRef.current;
        if (confirmedRef.current[item.id]) continue;
        setActiveItem(item.id);
        try {
          let txHash: Hex;
          if (item.id === 'watching') {
            if (funds.agent === zeroAddress) {
              throw new Error(`Create your automation account on ${lasnaName} first.`);
            }
            txHash = await fundingWallet.depositWatchingCredit(
              owner,
              funds.agent,
              funds.lasnaSystem,
              item.amount,
              connectorUid,
            );
          } else if (item.id === 'execution') {
            if (funds.vault === zeroAddress || !funds.proxy || funds.proxy === zeroAddress) {
              throw new Error('Execution credit is unavailable for this vault.');
            }
            txHash = await fundingWallet.depositExecutionCredit(
              owner,
              funds.vault,
              funds.proxy,
              chainId,
              item.amount,
              connectorUid,
            );
          } else {
            if (funds.vault === zeroAddress || funds.usdc === zeroAddress) {
              throw new Error('Test USDC is unavailable for this vault.');
            }
            txHash = await fundingWallet.depositUsdc(
              owner,
              funds.vault,
              funds.usdc,
              chainId,
              item.amount,
              connectorUid,
            );
          }
          if (runGenerationRef.current !== runId) return confirmedRef.current;
          confirmedRef.current = { ...confirmedRef.current, [item.id]: txHash };
          setConfirmed(confirmedRef.current);
        } catch (cause) {
          if (runGenerationRef.current === runId) {
            setFailedItem(item.id);
          }
          throw cause;
        }
      }
      return confirmedRef.current;
    },
    onSettled: async () => {
      setActiveItem(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflow-v2'] }),
        queryClient.invalidateQueries({ queryKey: ['balance'] }),
        queryClient.invalidateQueries({ queryKey: ['readContract'] }),
      ]);
    },
  });

  const resetDeposit = deposit.reset;
  useEffect(() => {
    runGenerationRef.current += 1;
    confirmedRef.current = {};
    setConfirmed({});
    setActiveItem(undefined);
    setFailedItem(undefined);
    resetDeposit();
    return () => {
      runGenerationRef.current += 1;
    };
  }, [owner, chainId, resetDeposit]);

  return {
    fundsQuery,
    confirmed,
    activeItem,
    failedItem,
    deposit: deposit.mutate,
    depositing: deposit.isPending,
    depositError: deposit.error,
    resetError: resetDeposit,
  };
}
