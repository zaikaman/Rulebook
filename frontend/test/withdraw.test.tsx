import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BalanceTrio } from '../src/components/BalanceTrio.js';
import { WithdrawForm } from '../src/components/WithdrawForm.js';
import { DEMO_USDC } from '../src/lib/contracts.js';

const USER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VAULT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const HASH = `0x${'1'.repeat(64)}` as const;

const mocks = vi.hoisted(() => ({
  writeContractAsync: vi.fn(),
  switchChainAsync: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: USER, chainId: 1301 }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: mocks.writeContractAsync }),
  useWaitForTransactionReceipt: () => ({ data: undefined, isLoading: false }),
}));

describe('WithdrawForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeContractAsync.mockResolvedValue(HASH);
  });

  it('disables withdrawal when there is no principal', () => {
    render(
      <WithdrawForm
        vault={VAULT}
        token={DEMO_USDC}
        tokenSymbol="USDC"
        tokenDecimals={6}
        principal={0n}
      />,
    );
    expect(screen.getByText(/no principal to withdraw/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeDisabled();
  });

  it('rejects an invalid destination and an amount above principal', async () => {
    const user = userEvent.setup();
    render(
      <WithdrawForm
        vault={VAULT}
        token={DEMO_USDC}
        tokenSymbol="USDC"
        tokenDecimals={6}
        principal={10_000_000n}
      />,
    );

    await user.type(screen.getByLabelText(/withdrawal amount/i), '20');
    await user.clear(screen.getByLabelText(/destination address/i));
    await user.type(screen.getByLabelText(/destination address/i), '0x1234');
    await user.click(screen.getByRole('checkbox'));

    expect(screen.getByText(/enter an amount up to/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/withdrawal amount/i));
    expect(screen.getByText(/valid destination/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeDisabled();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });

  it('signs the withdrawal on Unichain Sepolia after destination confirmation', async () => {
    const user = userEvent.setup();
    render(
      <WithdrawForm
        vault={VAULT}
        token={DEMO_USDC}
        tokenSymbol="USDC"
        tokenDecimals={6}
        principal={10_000_000n}
      />,
    );

    await user.type(screen.getByLabelText(/withdrawal amount/i), '2');
    await user.click(screen.getByRole('checkbox'));
    const button = screen.getByRole('button', { name: /withdraw/i });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: VAULT,
        functionName: 'withdraw',
        args: [DEMO_USDC, 2_000_000n, USER],
        chainId: 1301,
      }),
    );
  });
});

describe('BalanceTrio', () => {
  it('shows three separately labelled figures and no combined total', () => {
    render(<BalanceTrio principal="10 USDC" executionCost="0.01 ETH" watchingCredit="0.2 REACT" />);

    expect(screen.getByText('Principal (your funds)')).toBeInTheDocument();
    expect(screen.getByText('Execution cost (funds side, sponsored)')).toBeInTheDocument();
    expect(screen.getByText('Watching credit (automation side)')).toBeInTheDocument();
    expect(screen.getByText('10 USDC')).toBeInTheDocument();
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });
});
