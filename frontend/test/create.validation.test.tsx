import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('CreateRuleForm validation', () => {
  it('blocks submission with a missing amount, highlights the slot, and names it', async () => {
    const user = userEvent.setup();
    render(<CreateRuleForm agent={AGENT} />);

    await user.selectOptions(screen.getByLabelText('pay with'), 'USDC');
    await user.selectOptions(screen.getByLabelText('buy'), 'WETH');
    await user.selectOptions(screen.getByLabelText('schedule'), 'every day');

    await user.click(screen.getByRole('button', { name: 'Review and create rule' }));

    expect(mocks.sendTransactionAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/amount/i);
    expect(screen.getByLabelText('amount')).toHaveAttribute('aria-invalid', 'true');
    expect(document.querySelector('[data-slot="amount_in"]')).toHaveAttribute(
      'data-invalid',
      'true',
    );
  });

  it('never offers a free-text field', () => {
    render(<CreateRuleForm agent={AGENT} />);
    const inputs = document.querySelectorAll('input[type="text"], textarea');
    expect(inputs).toHaveLength(0);
  });
});
