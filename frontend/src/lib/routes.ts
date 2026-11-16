export const appRoutes = {
  landing: '/',
  rules: '/rules',
  create: '/create',
  marketplace: '/marketplace',
  leaderboard: '/leaderboard',
  proof: '/proof',
  account: '/account',
  cost: '/cost',
} as const;

export type AppHref = (typeof appRoutes)[keyof typeof appRoutes];

export function isActiveRoute(pathname: string, route: string, exact: boolean): boolean {
  return exact ? pathname === route : pathname === route || pathname.startsWith(`${route}/`);
}
