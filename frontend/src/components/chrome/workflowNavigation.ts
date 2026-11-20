import {
  Activity01Icon,
  Book02Icon,
  Coins01Icon,
  DocumentValidationIcon,
  Store01Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';

import { appRoutes } from '@/lib/routes';

export const workflowNavigation = [
  { label: 'Workflows', href: appRoutes.workflows, icon: Book02Icon, activeOn: [] },
  { label: 'Activity', href: appRoutes.activity, icon: Activity01Icon, activeOn: [] },
  { label: 'Marketplace', href: appRoutes.marketplace, icon: Store01Icon, activeOn: [] },
  {
    label: 'Account & Vault',
    shortLabel: 'Account',
    href: appRoutes.account,
    icon: Wallet01Icon,
    activeOn: [],
  },
  {
    label: 'Workflow proof',
    shortLabel: 'Proof',
    href: appRoutes.proof,
    icon: DocumentValidationIcon,
    activeOn: [appRoutes.runs],
  },
  {
    label: 'Workflow costs',
    shortLabel: 'Costs',
    href: appRoutes.cost,
    icon: Coins01Icon,
    activeOn: [],
  },
] as const;
