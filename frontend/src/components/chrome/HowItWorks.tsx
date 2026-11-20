import { HugeiconsIcon } from '@hugeicons/react';
import type { ComponentProps } from 'react';

export interface GuideStep {
  readonly icon: ComponentProps<typeof HugeiconsIcon>['icon'];
  readonly title: string;
  readonly copy: string;
}

export function HowItWorks({
  title,
  steps,
}: {
  readonly title: string;
  readonly steps: readonly GuideStep[];
}) {
  return (
    <section className="rb-guide" aria-label={title}>
      <h2 className="rb-guide-title">{title}</h2>
      <ol className="rb-guide-steps">
        {steps.map((step, index) => (
          <li key={step.title} className="rb-guide-step">
            <span className="rb-guide-icon" aria-hidden="true">
              <HugeiconsIcon icon={step.icon} size={17} strokeWidth={1.7} />
            </span>
            <div>
              <p className="rb-guide-step-title">
                <b aria-hidden="true">{index + 1}</b>
                {step.title}
              </p>
              <p className="rb-guide-copy">{step.copy}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
