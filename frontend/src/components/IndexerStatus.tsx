import { getChain } from '@rulebook/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api.js';

const HEALTH_KEY = ['health'] as const;

export function IndexerStatus() {
  const client = useQueryClient();
  const health = useQuery({
    queryKey: HEALTH_KEY,
    queryFn: () => api.health(),
    refetchInterval: 30_000,
    retry: false,
  });

  if (health.isPaused) return null;

  const data = health.data;
  const unavailable = health.isError || data?.database.reachable === false;
  const rpcFailures = data?.chains.filter((chain) => !chain.rpc_ok) ?? [];
  if (!unavailable && !rpcFailures.length) return null;

  return (
    <div
      className="app-alert mb-5 flex flex-wrap items-center justify-between gap-3"
      data-tone="warning"
    >
      <div role="status">
        {unavailable ? <p>The indexer is unavailable. Recent activity may be missing.</p> : null}
        {rpcFailures.length ? (
          <p>
            Chain reads are unavailable on{' '}
            {rpcFailures.map(({ chain_id }) => getChain(chain_id).name).join(' and ')}.
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="app-button"
        disabled={health.isFetching}
        onClick={() => void client.invalidateQueries()}
      >
        {health.isFetching ? 'Checking…' : 'Retry connection'}
      </button>
    </div>
  );
}
