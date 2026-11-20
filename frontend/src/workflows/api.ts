import { workflowListingSchema, workflowRunSchema } from '@rulebook/shared';
import { z } from 'zod';

const base = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
async function get<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch(base + path, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The workflow service could not load this request.');
  }
  return schema.parse(await response.json());
}

export const workflowApi = {
  marketplace(params: URLSearchParams, signal?: AbortSignal) {
    return get(
      '/v2/marketplace?' + params.toString(),
      z.object({ listings: z.array(workflowListingSchema), nextCursor: z.string().nullable() }),
      signal,
    );
  },
  listing(id: string, signal?: AbortSignal) {
    return get('/v2/marketplace/' + encodeURIComponent(id), workflowListingSchema, signal);
  },
  runs(agent: string, id: string, signal?: AbortSignal) {
    return get(
      '/v2/workflows/' + encodeURIComponent(agent) + '/' + encodeURIComponent(id) + '/runs',
      z.object({ runs: z.array(workflowRunSchema) }),
      signal,
    );
  },
  run(id: string, signal?: AbortSignal) {
    return get('/v2/runs/' + encodeURIComponent(id), workflowRunSchema, signal);
  },
};
