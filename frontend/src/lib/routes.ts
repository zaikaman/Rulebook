import type { FundsChainId, NetworkMode } from '@rulebook/shared';

import { withNetworkQuery } from './networkMode.js';

export const appRoutes = {
  landing: '/',
  setup: '/setup',
  create: '/create',
  workflows: '/workflows',
  newWorkflow: '/workflows/new',
  activity: '/activity',
  runs: '/runs',
  marketplace: '/marketplace',
  proof: '/proof',
  account: '/account',
  accountFunds: '/account/funds',
  cost: '/cost',
} as const;

export type AppHref = (typeof appRoutes)[keyof typeof appRoutes];

export function isActiveRoute(pathname: string, route: string, exact: boolean): boolean {
  return exact ? pathname === route : pathname === route || pathname.startsWith(`${route}/`);
}

export function stripNetworkQuery(path: string): string {
  const hashIndex = path.indexOf('#');
  const basePath = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex);
  const [pathname = '', rawSearch = ''] = basePath.split('?');
  const params = new URLSearchParams(rawSearch);
  params.delete('network');
  const query = params.toString();
  return `${query ? `${pathname}?${query}` : pathname}${hash}`;
}

export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = appRoutes.workflows,
): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return fallback;
  }
  try {
    const parsed = new URL(raw, 'https://rulebook.local');
    if (parsed.origin !== 'https://rulebook.local') return fallback;
    const normalizedPath = parsed.pathname.toLowerCase();
    if (
      normalizedPath === appRoutes.setup ||
      normalizedPath === appRoutes.create ||
      normalizedPath.startsWith(`${appRoutes.setup}/`) ||
      normalizedPath.startsWith(`${appRoutes.create}/`)
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function setupHref({
  next,
  chain,
  mode,
}: {
  readonly next?: string;
  readonly chain?: FundsChainId;
  readonly mode: NetworkMode;
}): string {
  const params = new URLSearchParams();
  if (next) {
    const cleanNext = stripNetworkQuery(safeNextPath(next, ''));
    if (cleanNext) {
      params.set('next', cleanNext);
    }
  }
  if (chain !== undefined) {
    params.set('chain', String(chain));
  }
  const query = params.toString();
  return withNetworkQuery(query ? `${appRoutes.setup}?${query}` : appRoutes.setup, mode);
}
