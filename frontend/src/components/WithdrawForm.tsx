import { UNICHAIN_SEPOLIA_CHAIN_ID, type Address, vaultAbi } from '@rulebook/shared';
import { useEffect, useState } from 'react';
import { formatUnits, isAddress, parseUnits, type Hex } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { useChainGuard } from '../hooks/useChainGuard.js';
import { signatureDetails } from '../lib/signatures.js';
import { Field } from '../ui/index.js';

import { ErrorState } from './ErrorState.js';
import { NetworkBadge } from './NetworkBadge.js';
import { Spinner } from './chrome/Spinner.js';
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
      <section className="app-alert grid gap-2" data-tone="success">
        <h2 className="app-panel-header app-panel-heading">
          Withdrawn on Unichain Sepolia <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
        </h2>
        <p className="app-copy">
          Principal arrived at {destination}. No operator approval was involved.
        </p>
        <TxLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} txHash={hash} label="View withdrawal" />
      </section>
    );
  }

  return (
    <section className="app-panel app-panel-pad grid gap-4">
      <h2 className="app-panel-header app-panel-heading">
        Withdraw principal <NetworkBadge chainId={UNICHAIN_SEPOLIA_CHAIN_ID} />
      </h2>
      <p className="app-copy">
        Available: {formatUnits(principal, tokenDecimals)} {tokenSymbol}. The owner signs on
        Unichain Sepolia; the operator cannot block or perform this.
      </p>

      <div className="grid gap-3 sm:grid-cols-[minmax(9rem,1fr)_minmax(0,2fr)]">
        <Field label={`Amount (${tokenSymbol})`}>
          <input
            aria-label="Withdrawal amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className="app-input"
          />
        </Field>

        <Field label="Destination">
          <input
            aria-label="Destination address"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className="app-input font-mono"
          />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1 accent-[var(--rb-accent)]"
        />
        I confirm this destination. Withdrawals are final and the operator cannot reverse them.
      </label>

      {validation ? (
        <p className={principal === 0n ? 'app-copy' : 'text-sm text-silent'}>{validation}</p>
      ) : null}
      {error ? (
        <ErrorState
          message="Withdrawal failed"
          detail={error}
          chainId={UNICHAIN_SEPOLIA_CHAIN_ID}
        />
      ) : null}

      <div className="app-form-actions">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="app-button app-button--primary"
        >
          {(submitting || receipt.isLoading) && <Spinner />}
          {submitting || receipt.isLoading ? 'Confirming on Unichain…' : 'Withdraw'}
        </button>
      </div>

      {hash && receipt.isLoading ? (
        <TxLink chainId={UNICHAIN_SEPOLIA_CHAIN_ID} txHash={hash} label="Pending on Unichain" />
      ) : null}
    </section>
  );
}
