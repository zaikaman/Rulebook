import { getChain, type TemplateSlot } from '@rulebook/shared';

const DAY = 86_400;

export function fieldOptions(slot: TemplateSlot, chainId: number, now: number) {
  const chain = getChain(chainId);
  switch (slot.kind) {
    case 'schedule':
      return [
        { label: 'Every hour', value: '3600' },
        { label: 'Every day', value: '86400' },
        { label: 'Every week', value: '604800' },
      ];
    case 'token':
      return [
        { label: 'USDC', value: chain.usdc },
        { label: 'WETH', value: chain.weth },
      ];
    case 'price':
      return [
        { label: '2,000', value: '2000000000000000000000' },
        { label: '2,500', value: '2500000000000000000000' },
        { label: '3,000', value: '3000000000000000000000' },
      ];
    case 'percent':
      return [
        { label: '1%', value: '100' },
        { label: '5%', value: '500' },
        { label: '10%', value: '1000' },
      ];
    case 'duration':
      return slot.unit === 'unix seconds'
        ? [30, 90, 365].map((days) => ({
            label: `In ${days} days`,
            value: String(now + days * DAY),
          }))
        : [30, 90, 180].map((days) => ({ label: `${days} days`, value: String(days) }));
    case 'address':
      return [{ label: 'USDC/WETH pool', value: chain.pair }];
    default:
      return [];
  }
}
