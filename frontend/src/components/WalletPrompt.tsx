import { Shield01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { CHAIN_CONFIGS } from '@rulebook/shared';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { Badge, Button, Dialog } from '../ui/index.js';
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const waitingRef = useRef<HTMLParagraphElement>(null);
  const isMainnet = CHAIN_CONFIGS.get(chainId)?.network === 'mainnet';

  useEffect(() => {
    (busy ? waitingRef : cancelRef).current?.focus();
  }, [busy]);

  return (
    <Dialog
      labelledBy={titleId}
      describedBy={descriptionId}
      onCancel={onCancel}
      busy={busy}
      className="rb-wallet-prompt"
      data-network-mode={isMainnet ? 'mainnet' : 'testnet'}
    >
      <header className="rb-wallet-prompt__head">
        <span className="rb-wallet-prompt__mark" aria-hidden="true">
          <HugeiconsIcon icon={Shield01Icon} size={19} strokeWidth={1.7} />
        </span>
        <div className="rb-wallet-prompt__heading">
          <span className="rb-wallet-prompt__eyebrow">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="rb-wallet-prompt__badges">
          {isMainnet && <Badge tone="paused">Mainnet · Real funds</Badge>}
          <NetworkBadge chainId={chainId} />
        </div>
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
          <Button ref={cancelRef} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </footer>
      )}
    </Dialog>
  );
}
