import { HugeiconsIcon } from '@hugeicons/react';
import type { ComponentProps, ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon: ComponentProps<typeof HugeiconsIcon>['icon'];
}) {
  return (
    <div className="app-panel app-state">
      <span className="app-icon" aria-hidden="true">
        <HugeiconsIcon icon={icon} size={21} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
