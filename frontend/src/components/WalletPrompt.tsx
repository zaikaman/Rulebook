import { Shield01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { NetworkBadge } from './NetworkBadge.js';
import { Spinner } from './chrome/Spinner.js';

export interface WalletPromptActions {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly busy?: boolean | undefined;
}

export function WalletPrompt({
  title,
  eyebrow,
  chainId,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
}: WalletPromptActions & {
  readonly title: string;
  readonly eyebrow: string;
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
      className="app-dialog rb-wallet-prompt"
    >
      <header className="rb-wallet-prompt__head">
        <span className="rb-wallet-prompt__mark" aria-hidden="true">
          <HugeiconsIcon icon={Shield01Icon} size={19} strokeWidth={1.7} />
        </span>
        <div className="rb-wallet-prompt__heading">
          <span className="rb-wallet-prompt__eyebrow">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <NetworkBadge chainId={chainId} />
      </header>
      <div id={descriptionId} className="rb-wallet-prompt__body">
        {children}
      </div>
      {busy ? (
        <p ref={waitingRef} tabIndex={-1} role="status" className="rb-wallet-prompt__waiting">
          <Spinner />
          Confirm the request in your wallet.
        </p>
      ) : (
        <footer className="rb-wallet-prompt__foot">
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
        </footer>
      )}
    </dialog>,
    document.body,
  );
}
