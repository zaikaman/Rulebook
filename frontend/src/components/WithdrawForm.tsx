import { UNICHAIN_SEPOLIA_CHAIN_ID, type Address, vaultAbi } from '@rulebook/shared';
import { useEffect, useState } from 'react';
import { formatUnits, isAddress, parseUnits, type Hex } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { useChainGuard } from '../hooks/useChainGuard.js';
import { signatureDetails } from '../lib/signatures.js';

import { ErrorState } from './ErrorState.js';
import { NetworkBadge } from './NetworkBadge.js';
import { TxLink } from './TxLink.js';

export interface WithdrawFormProps {
  readonly vault: Address;
  readonly token: Address;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly principal: bigint;
  /** Called after the destination receipt confirms, so the account can refetch principal. */
  readonly onConfirmed?: () => void;
}

/**
 * Withdrawal is the custody proof: the owner signs on Unichain Sepolia directly against
 * their vault. Success is shown only after the destination-chain receipt confirms, never
 * from a Lasna receipt or a pending hash (FR-007, FR-051).
 */
export function WithdrawForm({
  vault,
  token,
  tokenSymbol,
  tokenDecimals,
  principal,
  onConfirmed,
}: WithdrawFormProps) {
  const { address } = useAccount();
  const requestSignature = useChainGuard();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState(address ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [hash, setHash] = useState<Hex>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const receipt = useWaitForTransactionReceipt({
    ...(hash ? { hash } : {}),
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
  });

  let amountWei: bigint | undefined;
  try {
    amountWei = amount ? parseUnits(amount, tokenDecimals) : undefined;
  } catch {
    amountWei = undefined;
  }

  const destinationValid = isAddress(destination);
  const amountValid = amountWei !== undefined && amountWei > 0n && amountWei <= principal;
  const canSubmit =
    Boolean(address) &&
    principal > 0n &&
    amountValid &&
    destinationValid &&
    confirmed &&
    !submitting &&
    !receipt.isLoading;

  useEffect(() => {
    if (receipt.data?.status === 'success') onConfirmed?.();
  }, [receipt.data, onConfirmed]);

  const validation =
    principal === 0n
      ? 'There is no principal to withdraw.'
      : amount && !amountValid
        ? `Enter an amount up to ${formatUnits(principal, tokenDecimals)} ${tokenSymbol}.`
        : destination && !destinationValid
          ? 'Enter a valid destination address.'
          : null;

  async function submit(): Promise<void> {
    if (!canSubmit || amountWei === undefined) return;
    setError(undefined);
    setSubmitting(true);
    try {
      const recipient = destination as Address;
      const txHash = await requestSignature(
        signatureDetails.withdraw(
          vault,
          recipient,
          `${formatUnits(amountWei, tokenDecimals)} ${tokenSymbol}`,
        ),
        address,
        () =>
          writeContractAsync({
            address: vault,
            account: address,
            abi: vaultAbi,
            functionName: 'withdraw',
            args: [token, amountWei, recipient],
            chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
          }),
      );
      setHash(txHash);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The withdrawal was not signed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt.data?.status === 'success' && hash) {
    return (
      <section className="space-y-2 rounded-lg border border-confirmed/40 p-4">
        <h2 className="flex items-center gap-2 font-medium">
          Withdrawn on Unichain Sepolia <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
        </h2>
        <p className="text-sm text-ink-muted">
          Principal arrived at {destination}. No operator approval was involved.
        </p>
        <TxLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} txHash={hash} label="View withdrawal" />
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="flex items-center gap-2 font-medium">
        Withdraw principal <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
      </h2>
      <p className="text-sm text-ink-muted">
        Available: {formatUnits(principal, tokenDecimals)} {tokenSymbol}. The owner signs on
        Unichain Sepolia; the operator cannot block or perform this.
      </p>

      <label className="block text-sm">
        Amount ({tokenSymbol})
        <input
          aria-label="Withdrawal amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          className="mt-1 w-full rounded border border-border bg-surface px-3 py-2"
        />
      </label>

      <label className="block text-sm">
        Destination
        <input
          aria-label="Destination address"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 font-mono text-xs"
        />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1"
        />
        I confirm this destination. Withdrawals are final and the operator cannot reverse them.
      </label>

      {validation ? <p className="text-sm text-cancelled">{validation}</p> : null}
      {error ? (
        <ErrorState
          message="Withdrawal failed"
          detail={error}
          chainId={UNICHAIN_SEPOLIA_CHAIN_ID}
        />
      ) : null}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void submit()}
        className="rounded bg-ink px-4 py-2 font-medium text-surface disabled:opacity-50"
      >
        {submitting || receipt.isLoading ? 'Confirming on Unichain…' : 'Withdraw'}
      </button>

      {hash && receipt.isLoading ? (
        <TxLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} txHash={hash} label="Pending on Unichain" />
      ) : null}
    </section>
  );
}
