import { getChain, type TemplateSlot } from '@rulebook/shared';

/** Preset choices for the slots that stay a select: tokens and the suggested price pair. */
export function fieldOptions(slot: TemplateSlot, chainId: number) {
  const chain = getChain(chainId);
  switch (slot.kind) {
    case 'token':
      return [
        { label: 'USDC', value: chain.usdc },
        { label: 'WETH', value: chain.weth },
      ];
    case 'address':
      return [{ label: 'USDC/WETH pool', value: chain.pair }];
    default:
      return [];
  }
}
