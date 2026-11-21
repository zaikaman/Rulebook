import type { ReactNode } from 'react';

function focusHeading(heading: HTMLHeadingElement | null) {
  heading?.focus();
}

export function PageHeading({
  title,
  description,
  aside,
  breadcrumb,
  eyebrow,
  focusOnMount = false,
}: {
  readonly title: string;
  readonly description?: string;
  readonly aside?: ReactNode;
  readonly breadcrumb?: ReactNode;
  readonly eyebrow?: string;
  readonly focusOnMount?: boolean;
}) {
  return (
    <header className="app-heading">
      <div className="app-heading-main">
        {breadcrumb ? (
          <nav aria-label="Breadcrumb" className="app-breadcrumb">
            {breadcrumb}
          </nav>
        ) : null}
        {eyebrow ? <p className="app-eyebrow">{eyebrow}</p> : null}
        <h1 ref={focusOnMount ? focusHeading : undefined} tabIndex={focusOnMount ? -1 : undefined}>
          {title}
        </h1>
        {description ? <p className="app-heading-copy">{description}</p> : null}
      </div>
      {aside ? <div className="app-heading-aside">{aside}</div> : null}
    </header>
  );
}
