import { getChain } from '@rulebook/shared';
import { Spinner } from '@/components/chrome/Spinner';
import type { useWorkflowWallet } from './chain';

export function WalletFeedback({ wallet }: { wallet: ReturnType<typeof useWorkflowWallet> }) {
  return (
    <div className="workflow-feedback" aria-live="polite">
      {wallet.status && (
        <p className={wallet.busy ? 'rb-loading' : undefined}>
          {wallet.busy && <Spinner size={13} />}
          {wallet.status}
        </p>
      )}
      {wallet.error && (
        <p role="alert" className="workflow-error">
          {wallet.error}
        </p>
      )}
      {wallet.transaction && (
        <a
          className="app-link"
          target="_blank"
          rel="noreferrer"
          href={getChain(wallet.transaction.chainId).explorerUrl + '/tx/' + wallet.transaction.hash}
        >
          View latest transaction on {getChain(wallet.transaction.chainId).name}
        </a>
      )}
    </div>
  );
}
