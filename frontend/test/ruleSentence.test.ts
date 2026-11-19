import { getChain, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { expect, it } from 'vitest';

import { formatRuleSentence } from '../src/lib/rules.js';

const chainId = UNICHAIN_SEPOLIA_CHAIN_ID;
const { usdc, weth } = getChain(chainId);

it('renders the DCA schedule and exact amount in the token that pays for the purchase', () => {
  expect(
    formatRuleSentence({
      template: 1,
      chainId,
      slots: { schedule: '86400', amount_in: '10000001', token_in: usdc, token_out: weth },
    }),
  ).toBe('Every day, spend 10.000001 USDC to buy WETH.');
});

it('keeps base units and the full address when the payment token is unknown', () => {
  const token = '0x1111111111111111111111111111111111111111';
  expect(
    formatRuleSentence({
      template: 1,
      chainId,
      slots: { schedule: '5400', amount_in: '10000000', token_in: token, token_out: weth },
    }),
  ).toBe(`Every 90 minutes, spend 10000000 base units of ${token} to buy WETH.`);
});
