import type { Address } from '@rulebook/shared';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

import type { SignatureDetails } from '../lib/signatures.js';

type RequestSignature = <T>(
  details: SignatureDetails,
  signer: Address | undefined,
  sign: () => Promise<T>,
  signal: AbortSignal,
) => Promise<T>;

export const WalletReviewContext = createContext<RequestSignature | null>(null);

export function useChainGuard(): <T>(
  details: SignatureDetails,
  signer: Address | undefined,
  sign: () => Promise<T>,
) => Promise<T> {
  const requestSignature = useContext(WalletReviewContext);
  const controller = useRef<AbortController>(null);
  useEffect(() => {
    const lifetime = new AbortController();
    controller.current = lifetime;
    return () => lifetime.abort();
  }, []);

  return useCallback(
    async (details, signer, sign) => {
      if (!requestSignature || !controller.current) {
        throw new Error('Wallet review is unavailable.');
      }
      return requestSignature(details, signer, sign, controller.current.signal);
    },
    [requestSignature],
  );
}
