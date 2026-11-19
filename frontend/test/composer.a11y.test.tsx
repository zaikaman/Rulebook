import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderComponent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

function render(component: Parameters<typeof renderComponent>[0]) {
  return renderComponent(
    <QueryClientProvider client={new QueryClient()}>{component}</QueryClientProvider>,
  );
}

import { CreateRuleForm } from '../src/pages/Create.js';

const USER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;

const mocks = vi.hoisted(() => ({
  sendTransactionAsync: vi.fn(),
  switchChainAsync: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: USER, chainId: 5318007 }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
  useSendTransaction: () => ({ sendTransactionAsync: mocks.sendTransactionAsync }),
}));

vi.mock('../src/lib/wagmi.js', () => ({
  lasnaPublicClient: {
    call: vi.fn().mockResolvedValue({ data: '0x' }),
    waitForTransactionReceipt: vi.fn(),
  },
}));

describe('composer accessibility', () => {
  it('is operable with the keyboard alone', async () => {
    const user = userEvent.setup();
    render(<CreateRuleForm agent={AGENT} />);

    const controls = screen.getAllByRole('combobox');
    expect(controls.length).toBeGreaterThan(1);
    for (const control of controls) expect(control.tagName).toBe('SELECT');

    await user.tab();
    expect(screen.getByLabelText('Rule type')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Pay with')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Receive')).toHaveFocus();
    await user.tab();
    const amount = screen.getByRole('textbox', { name: 'Amount to spend' });
    expect(amount).toHaveFocus();
    await user.keyboard('0.1');
    expect(amount).toHaveValue('0.1');
  });

  it('has zero axe violations on the composer', async () => {
    const { container } = render(<CreateRuleForm agent={AGENT} />);
    const results = await axe.run(container, {
      rules: {
        // jsdom does not compute rendered colours, so contrast is verified visually instead.
        'color-contrast': { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });
});
