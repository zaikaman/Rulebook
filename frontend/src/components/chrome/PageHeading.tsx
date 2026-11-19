import type { ReactNode } from 'react';

function focusHeading(heading: HTMLHeadingElement | null) {
  heading?.focus();
}

export function PageHeading({
  title,
  description,
  aside,
  breadcrumb,
  focusOnMount = false,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  breadcrumb?: ReactNode;
  focusOnMount?: boolean;
}) {
  return (
    <header className="app-heading">
      <div>
        {breadcrumb ? (
          <nav aria-label="Breadcrumb" className="app-breadcrumb">
            {breadcrumb}
          </nav>
        ) : null}
        <h1 ref={focusOnMount ? focusHeading : undefined} tabIndex={focusOnMount ? -1 : undefined}>
          {title}
        </h1>
        {description ? <p>{description}</p> : null}
      </div>
      {aside}
    </header>
  );
}
