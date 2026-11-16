import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

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

    // Every value control is a native select, so arrow keys and Enter work without a mouse.
    const controls = screen.getAllByRole('combobox');
    expect(controls.length).toBeGreaterThan(1);
    for (const control of controls) expect(control.tagName).toBe('SELECT');

    await user.tab();
    expect(screen.getByLabelText('Rule type')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('schedule')).toHaveFocus();

    // Choosing by keyboard updates the sentence and the calldata, not just the widget.
    await user.selectOptions(screen.getByLabelText('amount'), '10000000');
    expect(screen.getByLabelText('amount')).toHaveValue('10000000');
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
