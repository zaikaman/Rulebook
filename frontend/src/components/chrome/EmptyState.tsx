import { HugeiconsIcon } from '@hugeicons/react';
import type { ComponentProps, ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
  icon,
  steps,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon: ComponentProps<typeof HugeiconsIcon>['icon'];
  steps?: readonly string[];
}) {
  return (
    <div className="rb-empty">
      <span className="rb-empty-icon" aria-hidden="true">
        <HugeiconsIcon icon={icon} size={22} strokeWidth={1.7} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="rb-empty-actions">{action}</div> : null}
      {steps?.length ? (
        <div className="rb-empty-steps">
          {steps.map((step, index) => (
            <span className="rb-empty-step" key={step}>
              <b aria-hidden="true">{index + 1}</b>
              {step}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
