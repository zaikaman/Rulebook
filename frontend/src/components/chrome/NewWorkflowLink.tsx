import { Add01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { NavLink } from 'react-router';

import { cx } from '@/lib/cx';
import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { appRoutes } from '@/lib/routes';

export function NewWorkflowLink({ compact = false }: { readonly compact?: boolean }) {
  const { mode } = useNetworkMode();

  return (
    <NavLink
      to={withNetworkQuery(appRoutes.newWorkflow, mode)}
      end
      className={cx(
        'app-button app-button--primary shrink-0 gap-2',
        compact ? 'app-nav-create-compact' : 'w-full',
      )}
    >
      <HugeiconsIcon icon={Add01Icon} size={18} aria-hidden="true" />
      <span className={compact ? 'sr-only' : undefined}>New workflow</span>
    </NavLink>
  );
}
