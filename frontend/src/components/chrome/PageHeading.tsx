import type { ReactNode } from 'react';

export function PageHeading({
  title,
  description,
  aside,
  breadcrumb,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="app-heading">
      <div>
        {breadcrumb ? (
          <nav aria-label="Breadcrumb" className="app-breadcrumb">
            {breadcrumb}
          </nav>
        ) : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {aside}
    </header>
  );
}
