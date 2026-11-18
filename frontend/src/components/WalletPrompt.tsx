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
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-2xl border border-border bg-surface-raised p-5 text-ink shadow-2xl backdrop:bg-surface backdrop:opacity-80 sm:p-6"
    >
      <div className="space-y-2">
        <NetworkBadge chainId={chainId} />
        <h2 id={titleId} className="text-lg font-semibold leading-snug">
          {title}
        </h2>
      </div>
      <div id={descriptionId} className="mt-4 space-y-3 break-words text-sm text-ink-muted">
        {children}
      </div>
      {busy ? (
        <p ref={waitingRef} tabIndex={-1} role="status" className="mt-5 text-sm">
          Confirm the request in your wallet.
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-surface hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {confirmLabel}
          </button>
        </div>
      )}
    </dialog>,
    document.body,
  );
}
