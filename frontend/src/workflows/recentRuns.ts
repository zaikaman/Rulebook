import { workflowV2RecentRunsResponseSchema, type NetworkMode } from '@rulebook/shared';
import { queryOptions } from '@tanstack/react-query';

import { v2ApiBase } from './listingV2.js';

export function recentVerifiedRunsQuery(mode: NetworkMode, limit = 6, enabled = true) {
  return queryOptions({
    queryKey: ['workflow-v2', 'recent-runs', mode, limit],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${v2ApiBase}/v3/runs/recent?network=${mode}&limit=${limit}`, {
        signal,
      });
      if (!response.ok) throw new Error('Could not load recent verified runs.');
      const parsed = workflowV2RecentRunsResponseSchema.parse(await response.json());
      return parsed.runs;
    },
    staleTime: 30_000,
    retry: false,
  });
}
