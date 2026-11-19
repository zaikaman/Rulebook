import type { Address } from '@rulebook/shared';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useConfig, useSwitchChain, type Connector } from 'wagmi';
import { getAccount } from 'wagmi/actions';

import { WalletReviewContext } from '../hooks/useChainGuard.js';
import { isWalletUnauthorized, WalletAuthorizationError } from '../lib/errors.js';
import type { SignatureDetails } from '../lib/signatures.js';
import { ChainSwitchPrompt } from './ChainSwitchPrompt.js';
import { SignatureSummary } from './SignatureSummary.js';
import type { WalletPromptActions } from './WalletPrompt.js';

interface Review extends WalletPromptActions {
  readonly id: number;
  readonly stage: 'switch' | 'review';
  readonly details: SignatureDetails;
}

export function WalletReviewProvider({ children }: { readonly children: ReactNode }) {
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const [review, setReview] = useState<Review>();
  const pending = useRef(false);
  const nextPrompt = useRef(0);

  const requestSignature = useCallback(
    async <T,>(
      details: SignatureDetails,
      signer: Address | undefined,
      sign: (connector: Connector) => Promise<T>,
      signal: AbortSignal,
      reviewedSetupConnector?: string,
      beforeSign?: () => Promise<void>,
    ): Promise<T> => {
      signal.throwIfAborted();
      if (pending.current) throw new Error('Finish the open wallet request first.');
      const account = getAccount(config);
      const connector = account.connector;
      if (!signer || !connector || account.address?.toLowerCase() !== signer.toLowerCase()) {
        throw new Error('Connect the wallet that owns this account.');
      }
      // Account setup reviews its full plan on the page before asking the wallet to act.
      const reviewedSetup = reviewedSetupConnector !== undefined;
      if (reviewedSetup && connector.uid !== reviewedSetupConnector) {
        throw new Error('Your wallet changed. Review setup again with the intended wallet.');
      }

      function checkWallet() {
        signal.throwIfAborted();
        const current = getAccount(config);
        if (
          current.connector?.uid !== connector?.uid ||
          current.address?.toLowerCase() !== account.address?.toLowerCase()
        ) {
          throw new Error('Your wallet changed. Review the action again with the intended wallet.');
        }
      }

      function confirm(stage: Review['stage']): Promise<void> {
        return new Promise((resolve, reject) => {
          const onCancel = () => {
            signal.removeEventListener('abort', onCancel);
            reject(new Error('You cancelled the wallet review.'));
          };
          let confirmed = false;
          signal.addEventListener('abort', onCancel, { once: true });
          setReview({
            id: ++nextPrompt.current,
            stage,
            details,
            onCancel,
            onConfirm: () => {
              if (confirmed || signal.aborted) return;
              confirmed = true;
              signal.removeEventListener('abort', onCancel);
              setReview((current) => current && { ...current, busy: true });
              resolve();
            },
          });
        });
      }

      pending.current = true;
      try {
        const startingChain = await connector.getChainId();
        checkWallet();
        if (startingChain !== details.chainId) {
          if (!reviewedSetup) await confirm('switch');
          checkWallet();
          const currentChain = await connector.getChainId();
          checkWallet();
          if (currentChain !== details.chainId) {
            await switchChainAsync({ chainId: details.chainId, connector });
          }
          checkWallet();
        }
        if (!reviewedSetup) await confirm('review');
        checkWallet();
        if (beforeSign) {
          await beforeSign();
          checkWallet();
        }
        const authorizedAccounts = await connector.getAccounts();
        checkWallet();
        if (!authorizedAccounts.some((address) => address.toLowerCase() === signer.toLowerCase())) {
          throw new WalletAuthorizationError(details.chainId);
        }
        const chainId = await connector.getChainId();
        checkWallet();
        if (chainId !== details.chainId) {
          throw new Error('Your wallet is on a different network. Review the action again.');
        }
        return await sign(connector);
      } catch (error) {
        if (isWalletUnauthorized(error)) {
          throw new WalletAuthorizationError(details.chainId, error);
        }
        throw error;
      } finally {
        setReview(undefined);
        pending.current = false;
      }
    },
    [config, switchChainAsync],
  );

  return (
    <WalletReviewContext.Provider value={requestSignature}>
      {children}
      {review?.stage === 'switch' ? <ChainSwitchPrompt key={review.id} {...review} /> : null}
      {review?.stage === 'review' ? <SignatureSummary key={review.id} {...review} /> : null}
    </WalletReviewContext.Provider>
  );
}
