import { useEffect, useState } from 'react';

import { describeError } from '../lib/errors.js';
import { StatusPill, type RuleStatus } from './StatusPill.js';

export interface RuleActionsProps {
  readonly ruleId: bigint;
  readonly status: RuleStatus;
  readonly onPause: () => Promise<unknown>;
  readonly onResume: () => Promise<unknown>;
  readonly onCancel: () => Promise<unknown>;
  readonly onRearm?: () => Promise<unknown>;
}

function reasonFor(error: unknown): string {
  const known = describeError(error);
  if (known) return known.message;
  return error instanceof Error ? error.message : 'The contract refused this change.';
}

/**
 * Pause, resume, and cancel for one rule. The pill updates immediately; a rejected transaction
 * restores the previous status and names the chain's reason, so the user never sees a control
 * that lies about what the Agent accepted. Cancel asks once before it is submitted.
 */
export function RuleActions({
  ruleId,
  status,
  onPause,
  onResume,
  onCancel,
  onRearm,
}: RuleActionsProps) {
  const [display, setDisplay] = useState<RuleStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    setDisplay(status);
  }, [status]);

  const run = async (next: RuleStatus, action: () => Promise<unknown>): Promise<void> => {
    const previous = display;
    setDisplay(next);
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (cause) {
      setDisplay(previous);
      setError(reasonFor(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={display} />
        <span className="font-mono text-xs text-ink-muted">#{ruleId.toString()}</span>

        {display === 'paused' ? (
          <button
            type="button"
            className="app-button"
            disabled={pending}
            onClick={() => void run('active', onResume)}
          >
            Resume
          </button>
        ) : null}

        {display === 'active' || display === 'latched' || display === 'waiting-funds' ? (
          <button
            type="button"
            className="app-button"
            disabled={pending}
            onClick={() => void run('paused', onPause)}
          >
            Pause
          </button>
        ) : null}

        {display === 'latched' && onRearm && (
          <button
            type="button"
            className="app-button"
            disabled={pending}
            onClick={() => void run('active', onRearm)}
          >
            Rearm rule
          </button>
        )}

        {display !== 'cancelled' ? (
          confirmingCancel ? (
            <span className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="app-button app-button--danger"
                disabled={pending}
                onClick={() => {
                  setConfirmingCancel(false);
                  void run('cancelled', onCancel);
                }}
              >
                Confirm cancel
              </button>
              <button
                type="button"
                className="app-button"
                disabled={pending}
                onClick={() => setConfirmingCancel(false)}
              >
                Keep rule
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="app-button app-button--danger"
              disabled={pending}
              onClick={() => setConfirmingCancel(true)}
            >
              Cancel rule
            </button>
          )
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="app-alert text-sm" data-tone="error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
