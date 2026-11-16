import { NetworkBadge } from './NetworkBadge.js';

export interface ErrorStateProps {
  /** Plain-language explanation. */
  readonly message: string;
  /** Raw chain-level reason or selector; preserved, never swallowed. */
  readonly detail?: string | null;
  /** Chain the failure happened on, so the user knows which network to look at. */
  readonly chainId?: number;
}

/** Renders a failure with its network and its underlying chain reason (FR-051). */
export function ErrorState({ message, detail, chainId }: ErrorStateProps) {
  return (
    <div role="alert" className="rounded-lg border border-cancelled/40 bg-cancelled/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{message}</span>
        {chainId !== undefined ? <NetworkBadge chainId={chainId} /> : null}
      </div>
      {detail ? (
        <code
          data-testid="error-detail"
          className="mt-2 block break-all font-mono text-xs text-ink-muted"
        >
          {detail}
        </code>
      ) : null}
    </div>
  );
}
