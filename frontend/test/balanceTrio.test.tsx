import { render, screen, within } from '@testing-library/react';
import { expect, expectTypeOf, it } from 'vitest';

import { BalanceTrio, type BalanceTrioProps } from '../src/components/BalanceTrio.js';

it('shows only three independently labelled figures, grouped by network and ownership', () => {
  expectTypeOf<keyof Omit<BalanceTrioProps, 'accounts'>>().toEqualTypeOf<
    'principal' | 'executionCost' | 'watchingCredit'
  >();
  render(
    <BalanceTrio
      principal="10 USDC"
      executionCost="0.01 ETH"
      watchingCredit="0.2 REACT"
      accounts={{
        agent: '0x1111111111111111111111111111111111111111',
        vault: '0x2222222222222222222222222222222222222222',
      }}
    />,
  );

  const funds = within(screen.getByRole('region', { name: 'Unichain Sepolia balances' }));
  expect(funds.getByText('Principal (your funds)')).toBeVisible();
  expect(funds.getByText('Execution cost (sponsored)')).toBeVisible();
  expect(funds.getByText('10 USDC')).toBeVisible();
  expect(funds.getByText('0.01 ETH')).toBeVisible();
  const watching = within(screen.getByRole('region', { name: 'Reactive Lasna balances' }));
  expect(watching.getByText('Watching credit (sponsored)')).toBeVisible();
  expect(watching.getByText('0.2 REACT')).toBeVisible();
  expect(screen.getAllByRole('definition')).toHaveLength(3);
  expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
});
