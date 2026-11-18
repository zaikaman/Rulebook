import { getChain } from '@rulebook/shared';

import type { SignatureDetails } from '../lib/signatures.js';
import { WalletPrompt, type WalletPromptActions } from './WalletPrompt.js';

export function ChainSwitchPrompt({
  details,
  ...actions
}: WalletPromptActions & { readonly details: SignatureDetails }) {
  const network = getChain(details.chainId);
  const label = `Switch to ${network.name}`;
  return (
    <WalletPrompt {...actions} title={label} confirmLabel={label} chainId={network.chainId}>
      <p>
        This action needs {network.name} because it targets your {details.targetLabel.toLowerCase()}
        {network.role === 'automation' ? ', where you manage rules.' : ', where your funds live.'}
      </p>
      <p>{details.effect}</p>
      <p>You can review the signature after switching.</p>
    </WalletPrompt>
  );
}
