export const appRoutes = {
  landing: '/',
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
