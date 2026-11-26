import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { getChain } from '@rulebook/shared';

import type { SignatureDetails } from '../lib/signatures.js';
import { WalletPrompt, type WalletPromptActions } from './WalletPrompt.js';

export function SignatureSummary({
  details,
  ...actions
}: WalletPromptActions & { readonly details: SignatureDetails }) {
  const network = getChain(details.chainId);
  const isMainnet = network.network === 'mainnet';
  return (
    <WalletPrompt
      {...actions}
      eyebrow={isMainnet ? 'Mainnet signature · Real funds' : 'Signature review'}
      title={`Review signature on ${network.name}`}
      confirmLabel={isMainnet ? 'Continue to wallet (Mainnet)' : 'Continue to wallet'}
      chainId={network.chainId}
    >
      {isMainnet && (
        <div className="rb-wallet-prompt__mainnet-warning" role="note">
          <HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={1.8} aria-hidden="true" />
          <p>
            You are signing on {network.name} Mainnet. Real funds and network fees cannot be
            reversed once confirmed.
          </p>
        </div>
      )}
      <p className="rb-wallet-prompt__lede">{details.effect}</p>
      <dl className="rb-wallet-prompt__facts">
        <div>
          <dt>{details.targetLabel}</dt>
          <dd>
            <code>{details.target}</code>
          </dd>
        </div>
        <div>
          <dt>{details.amountLabel ?? 'Principal'}</dt>
          <dd>{details.amount}</dd>
        </div>
      </dl>
      <p className="rb-wallet-prompt__hint">
        Your wallet shows the final request and fee before anything is signed.
      </p>
    </WalletPrompt>
  );
}
