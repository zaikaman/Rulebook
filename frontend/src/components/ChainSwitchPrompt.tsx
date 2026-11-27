import { getChain } from '@rulebook/shared';

import type { SignatureDetails } from '../lib/signatures.js';
import { WalletPrompt, type WalletPromptActions } from './WalletPrompt.js';

export function ChainSwitchPrompt({
  details,
  ...actions
}: WalletPromptActions & { readonly details: SignatureDetails }) {
  const network = getChain(details.chainId);
  const isMainnet = network.network === 'mainnet';
  const label = `Switch to ${network.name}`;
  return (
    <WalletPrompt
      {...actions}
      eyebrow={isMainnet ? 'Mainnet network switch' : 'Network switch'}
      title={label}
      confirmLabel={label}
      chainId={network.chainId}
      offChain={details.offChain}
    >
      <div className="rb-wallet-prompt__copy">
        <p>
          This action needs {network.name} because it targets your{' '}
          {details.targetLabel.toLowerCase()}
          {network.role === 'automation'
            ? ', where you manage workflows.'
            : ', where your funds live.'}
        </p>
        <p>{details.effect}</p>
      </div>
      <p className="rb-wallet-prompt__hint">You can review the signature after switching.</p>
    </WalletPrompt>
  );
}
