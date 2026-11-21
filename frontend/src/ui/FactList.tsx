import type { ReactNode } from 'react';

import { cx } from './classNames.js';

export interface Fact {
  readonly term: ReactNode;
  readonly value: ReactNode;
  readonly valueClassName?: string;
}

export interface FactListProps {
  readonly items: readonly Fact[];
  readonly className?: string;
}

/** A definition list for transaction, listing, and workflow facts. */
export function FactList({ items, className }: FactListProps) {
  return (
    <dl className={cx('rb-spec-facts', className)}>
      {items.map((item, index) => (
        <div key={index}>
          <dt>{item.term}</dt>
          <dd className={item.valueClassName}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
