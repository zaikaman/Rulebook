import type { Address } from '@rulebook/shared';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { Connector } from 'wagmi';

import type { SignatureDetails } from '../lib/signatures.js';

type RequestSignature = <T>(
  details: SignatureDetails,
  signer: Address | undefined,
  sign: (connector: Connector) => Promise<T>,
  signal: AbortSignal,
  reviewedSetupConnector?: string,
  beforeSign?: () => Promise<void>,
) => Promise<T>;

export const WalletReviewContext = createContext<RequestSignature | null>(null);

export function useChainGuard(): <T>(
  details: SignatureDetails,
  signer: Address | undefined,
  sign: (connector: Connector) => Promise<T>,
  reviewedSetupConnector?: string,
  beforeSign?: () => Promise<void>,
) => Promise<T> {
  const requestSignature = useContext(WalletReviewContext);
  const controller = useRef<AbortController>(null);
  useEffect(() => {
    const lifetime = new AbortController();
    controller.current = lifetime;
    return () => lifetime.abort();
  }, []);

  return useCallback(
    async (details, signer, sign, reviewedSetupConnector, beforeSign) => {
      if (!requestSignature || !controller.current) {
        throw new Error('Wallet review is unavailable.');
      }
      return requestSignature(
        details,
        signer,
        sign,
        controller.current.signal,
        reviewedSetupConnector,
        beforeSign,
      );
    },
    [requestSignature],
  );
}
