import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { NetworkBadge } from './NetworkBadge.js';

export interface WalletPromptActions {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly busy?: boolean | undefined;
}

export function WalletPrompt({
  title,
  chainId,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
}: WalletPromptActions & {
  readonly title: string;
  readonly chainId: number;
  readonly children: ReactNode;
  readonly confirmLabel: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const waitingRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
        if (document.activeElement === document.body) {
          requestAnimationFrame(() => {
            if (document.activeElement === document.body) previous.focus();
          });
        }
      }
    };
  }, []);

  useEffect(() => {
    (busy ? waitingRef : cancelRef).current?.focus();
  }, [busy]);

  function handleKey(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onCancel();
    }
    if (event.key !== 'Tab') return;
    if (busy) {
      event.preventDefault();
      return;
    }
    const boundary = event.shiftKey ? cancelRef : confirmRef;
    const next = event.shiftKey ? confirmRef : cancelRef;
    if (document.activeElement === boundary.current) {
      event.preventDefault();
      next.current?.focus();
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      onKeyDown={handleKey}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="app-dialog app-panel app-panel-pad m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-auto text-ink shadow-2xl backdrop:bg-surface backdrop:opacity-80"
    >
      <div className="space-y-2">
        <NetworkBadge chainId={chainId} />
        <h2 id={titleId} className="app-panel-heading text-lg leading-snug">
          {title}
        </h2>
      </div>
      <div id={descriptionId} className="mt-4 space-y-3 break-words text-sm text-ink-muted">
        {children}
      </div>
      {busy ? (
        <p ref={waitingRef} tabIndex={-1} role="status" className="app-alert mt-5 text-sm">
          Confirm the request in your wallet.
        </p>
      ) : (
        <div className="app-divider mt-5 flex flex-wrap justify-end gap-2 pt-4">
          <button ref={cancelRef} type="button" onClick={onCancel} className="app-button">
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="app-button app-button--primary"
          >
            {confirmLabel}
          </button>
        </div>
      )}
    </dialog>,
    document.body,
  );
}
