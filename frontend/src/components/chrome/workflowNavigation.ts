import { Activity01Icon, Book02Icon, Store01Icon, Wallet01Icon } from '@hugeicons/core-free-icons';

import { appRoutes } from '@/lib/routes';

export const workflowNavigation = [
  { label: 'Workflows', href: appRoutes.workflows, icon: Book02Icon, activeOn: [] },
  { label: 'Activity', href: appRoutes.activity, icon: Activity01Icon, activeOn: [appRoutes.runs] },
  { label: 'Marketplace', href: appRoutes.marketplace, icon: Store01Icon, activeOn: [] },
  {
    label: 'Account & Vault',
    shortLabel: 'Account',
    href: appRoutes.account,
    icon: Wallet01Icon,
    activeOn: [],
  },
] as const;
