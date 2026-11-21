import { getChain } from '@rulebook/shared';

import type { SignatureDetails } from '../lib/signatures.js';
import { WalletPrompt, type WalletPromptActions } from './WalletPrompt.js';

export function SignatureSummary({
  details,
  ...actions
}: WalletPromptActions & { readonly details: SignatureDetails }) {
  const network = getChain(details.chainId);
  return (
    <WalletPrompt
      {...actions}
      eyebrow="Signature review"
      title={`Review signature on ${network.name}`}
      confirmLabel="Continue to wallet"
      chainId={network.chainId}
    >
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
