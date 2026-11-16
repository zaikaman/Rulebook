import { useQuery } from '@tanstack/react-query';

import { ApiError, api } from '../lib/api.js';

/** The distinct copy a proof failure needs. A missing record is not the same as a dead RPC. */
export function proofErrorCopy(error: unknown): { title: string; detail: string } {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return {
        title: 'No proof recorded yet',
        detail:
          'The validators have not written a callback record for this transaction yet. Try again in a minute.',
      };
    }
    if (error.status === 503) {
      return {
        title: 'Proof sources are unavailable',
        detail:
          'Both the Lasna chain read and the cached copy failed. Nothing is being presented as live.',
      };
    }
  }
  return {
    title: 'The proof could not be loaded',
    detail: error instanceof Error ? error.message : 'An unknown error occurred.',
  };
}

/**
 * Reads one proof through the backend. 4xx responses are not retried (the record does not
 * exist); 5xx responses get two retries, because a transient RPC failure is worth retrying.
 */
export function useProof(reactiveTxHash: string | undefined) {
  const validHash = Boolean(reactiveTxHash && /^0x[0-9a-fA-F]{64}$/.test(reactiveTxHash));

  return useQuery({
    queryKey: ['proof', reactiveTxHash],
    queryFn: () => api.proof(reactiveTxHash as string),
    enabled: validHash,
    retry: (failureCount, error) =>
      error instanceof ApiError ? error.status >= 500 && failureCount < 2 : failureCount < 2,
  });
}
