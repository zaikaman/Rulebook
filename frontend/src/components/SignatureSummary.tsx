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
      title={`Review signature on ${network.name}`}
      confirmLabel="Continue to wallet"
      chainId={network.chainId}
    >
      <p className="text-ink">{details.effect}</p>
      <dl className="space-y-3 border-t border-border pt-3">
        <div>
          <dt className="font-medium text-ink">{details.targetLabel}</dt>
          <dd className="break-all font-mono text-xs">{details.target}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">{details.amountLabel ?? 'Principal'}</dt>
          <dd>{details.amount}</dd>
        </div>
      </dl>
    </WalletPrompt>
  );
}
