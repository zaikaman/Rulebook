import { useEffect, useState, type ReactNode } from 'react';

import { describeError } from '../lib/errors.js';
import { STATUS_LABELS, type RuleStatus } from './StatusPill.js';
import { Spinner } from './chrome/Spinner.js';

export interface RuleActionsProps {
  readonly status: RuleStatus;
  readonly onPause: () => Promise<unknown>;
  readonly onResume: () => Promise<unknown>;
  readonly onCancel: () => Promise<unknown>;
  readonly onRearm?: () => Promise<unknown>;
  /**
   * Reports the state this control is showing, including the optimistic value and the value it
   * rolls back to when the chain refuses. The page owns the single status indicator.
   */
  readonly onStatusChange?: (status: RuleStatus) => void;
  /** Non-destructive actions that belong to the same group, such as editing the rule. */
  readonly children?: ReactNode;
}

function reasonFor(error: unknown): string {
  const known = describeError(error);
  if (known) return known.message;
  return error instanceof Error ? error.message : 'The contract refused this change.';
}

/**
 * Pause, resume, and cancel for one rule. The reported status changes immediately; a rejected
 * transaction restores the previous state and names the chain's reason, so the user never sees
 * a control that lies about what the Agent accepted. Cancel asks once before it is submitted.
 */
export function RuleActions({
  status,
  onPause,
  onResume,
  onCancel,
  onRearm,
  onStatusChange,
  children,
}: RuleActionsProps) {
  const [display, setDisplay] = useState<RuleStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | 'cancel' | 'rearm'>();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    setDisplay(status);
  }, [status]);

  useEffect(() => {
    onStatusChange?.(display);
  }, [display, onStatusChange]);

  const run = async (
    next: RuleStatus,
    action: () => Promise<unknown>,
    kind?: 'pause' | 'resume' | 'cancel' | 'rearm',
  ): Promise<void> => {
    const previous = display;
    setDisplay(next);
    setError(null);
    setPending(true);
    setPendingAction(kind);
    try {
      await action();
    } catch (cause) {
      setDisplay(previous);
      setError(reasonFor(cause));
    } finally {
      setPending(false);
      setPendingAction(undefined);
    }
  };

  return (
    <div className="app-rule-actions">
      <p role="status" aria-live="polite" className="sr-only">
        {pending
          ? 'Waiting for the rule change to confirm.'
          : `Rule status: ${STATUS_LABELS[display]}.`}
      </p>

      {display === 'paused' ? (
        <button
          type="button"
          className="app-button"
          disabled={pending}
          onClick={() => void run('active', onResume, 'resume')}
        >
          {pendingAction === 'resume' && <Spinner />}
          Resume rule
        </button>
      ) : null}

      {display === 'latched' && onRearm ? (
        <button
          type="button"
          className="app-button"
          disabled={pending}
          onClick={() => void run('active', onRearm, 'rearm')}
        >
          {pendingAction === 'rearm' && <Spinner />}
          Rearm rule
        </button>
      ) : null}

      {display === 'active' || display === 'latched' || display === 'waiting-funds' ? (
        <button
          type="button"
          className="app-button"
          disabled={pending}
          onClick={() => void run('paused', onPause, 'pause')}
        >
          {pendingAction === 'pause' && <Spinner />}
          Pause rule
        </button>
      ) : null}

      {children}

      {display !== 'cancelled' ? (
        <div className="app-rule-actions-danger">
          {confirmingCancel ? (
            <>
              <button
                type="button"
                className="app-button app-button--danger-solid"
                disabled={pending}
                onClick={() => {
                  setConfirmingCancel(false);
                  void run('cancelled', onCancel, 'cancel');
                }}
              >
                {pendingAction === 'cancel' && <Spinner />}
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
            </>
          ) : (
            <button
              type="button"
              className="app-button app-button--danger"
              disabled={pending}
              onClick={() => setConfirmingCancel(true)}
            >
              Cancel rule
            </button>
          )}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="app-alert text-sm" data-tone="error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
