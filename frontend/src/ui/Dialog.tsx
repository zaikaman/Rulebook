import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cx } from './classNames.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  readonly labelledBy: string;
  readonly describedBy?: string;
  readonly onCancel?: () => void;
  readonly busy?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A native modal dialog with the shared focus contract: show on mount, restore the previous
 * focus on unmount, close on Escape unless busy, and cycle Tab inside while open.
 */
export function Dialog({
  labelledBy,
  describedBy,
  onCancel,
  busy = false,
  className,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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

  function handleKey(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onCancel?.();
      return;
    }
    if (event.key !== 'Tab') return;
    if (busy) {
      event.preventDefault();
      return;
    }
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!focusable?.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-modal="true"
      onKeyDown={handleKey}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel?.();
      }}
      className={cx('app-dialog', className)}
    >
      {children}
    </dialog>,
    document.body,
  );
}
