import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api.js';

/**
 * Chain reads are stale after 30 seconds; API 4xx responses never retry (the request is wrong,
 * not flaky), while 5xx retries twice.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
