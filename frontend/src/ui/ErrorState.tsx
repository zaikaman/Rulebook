import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ReactNode } from 'react';

import { NetworkBadge } from '../components/NetworkBadge.js';
import { Button } from './Button.js';

export interface ErrorStateProps {
  /** Plain-language explanation. */
  readonly message: string;
  /** Raw chain-level reason or selector; preserved, never swallowed. */
  readonly detail?: string | null;
  /** Chain the failure happened on, so the user knows which network to look at. */
  readonly chainId?: number;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly children?: ReactNode;
}

/** Renders a failure with its network and its underlying chain reason (FR-051). */
export function ErrorState({
  message,
  detail,
  chainId,
  onRetry,
  retryLabel = 'Try again',
  children,
}: ErrorStateProps) {
  return (
    <div role="alert" className="rb-error">
      <span className="rb-error-mark" aria-hidden="true">
        <HugeiconsIcon icon={AlertCircleIcon} size={18} strokeWidth={1.8} />
      </span>
      <div className="rb-error-body">
        <div className="rb-error-head">
          <p className="rb-error-title">{message}</p>
          {chainId !== undefined ? <NetworkBadge chainId={chainId} /> : null}
        </div>
        {detail ? (
          <code data-testid="error-detail" className="rb-error-detail">
            {detail}
          </code>
        ) : null}
        {children ? <div className="rb-error-extra">{children}</div> : null}
        {onRetry ? (
          <div className="rb-error-actions">
            <Button onClick={onRetry}>{retryLabel}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
