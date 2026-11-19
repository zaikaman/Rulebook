import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as renderComponent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { agentAbi, getChain } from '@rulebook/shared';
import { decodeFunctionData, zeroAddress } from 'viem';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateRuleForm } from '../src/pages/Create.js';
import { assertRuleFunding } from '../src/lib/ruleFunding.js';

function render(component: Parameters<typeof renderComponent>[0]) {
  return renderComponent(
    <QueryClientProvider client={new QueryClient()}>{component}</QueryClientProvider>,
  );
}

const USER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const chain = getChain(1301);

const mocks = vi.hoisted(() => ({
  sendTransactionAsync: vi.fn(),
  switchChainAsync: vi.fn(),
  readContract: vi.fn(),
  linkedVault: vi.fn(),
  requestSignature: vi.fn(),
  simulate: vi.fn().mockResolvedValue({ data: '0x' }),
}));

vi.mock('../src/hooks/useChainGuard.js', () => ({
  useChainGuard: () => mocks.requestSignature,
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: USER, chainId: 5318007 }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
  useSendTransaction: () => ({ sendTransactionAsync: mocks.sendTransactionAsync }),
}));

vi.mock('../src/lib/wagmi.js', () => ({
  lasnaPublicClient: {
    call: mocks.simulate,
    readContract: mocks.linkedVault,
    waitForTransactionReceipt: vi.fn(),
  },
  unichainPublicClient: { readContract: mocks.readContract, getBlockNumber: async () => 10n },
  estimateAddRuleGas: async () => 100_000n,
}));

beforeEach(() => vi.clearAllMocks());

function reportVault({
  cap = 100_000_000n,
  balances,
  allowance = 0n,
}: {
  cap?: bigint;
  balances: bigint[];
  allowance?: bigint;
}) {
  mocks.linkedVault.mockResolvedValue(VAULT);
  mocks.readContract.mockImplementation(async ({ functionName }) => {
    switch (functionName) {
      case 'EXECUTION_PAYLOAD_VERSION':
        return 2;
      case 'agent':
        return AGENT;
      case 'paused':
      case 'mirrorMode':
        return false;
      case 'allowedTokenIn':
        return chain.usdc;
      case 'allowedTokenOut':
        return chain.weth;
      case 'maxSpendPerRun':
        return cap;
      case 'balanceOf':
        return balances.shift();
      case 'allowance':
        return allowance;
      default:
        throw new Error(`Unexpected contract read ${functionName}`);
    }
  });
}

async function fillTrade(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Pay with'), 'USDC');
  await user.selectOptions(screen.getByLabelText('Receive'), 'WETH');
  await user.type(screen.getByLabelText('Schedule'), '1');
}

describe('CreateRuleForm validation', () => {
  it('blocks submission with a missing amount and focuses the input', async () => {
    const user = userEvent.setup();
    render(<CreateRuleForm agent={AGENT} />);

    await fillTrade(user);

    await user.click(screen.getByRole('button', { name: 'Review and create rule' }));

    expect(mocks.sendTransactionAsync).not.toHaveBeenCalled();
    const amount = screen.getByLabelText('Amount to spend');
    expect(amount).toHaveAccessibleDescription('USDC Enter an amount.');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveFocus();
  });

  it('encodes a decimal spend exactly and rejects excess token precision', async () => {
    const user = userEvent.setup();
    render(<CreateRuleForm agent={AGENT} />);
    await fillTrade(user);
    const amount = screen.getByLabelText('Amount to spend');
    await user.type(amount, '0.0000001');
    await user.tab();
    expect(amount).toHaveAccessibleDescription('USDC Use up to 6 decimal places for this token.');
    expect(screen.queryByTestId('live-calldata')).toBeNull();

    await user.clear(amount);
    await user.type(amount, '0.100001');
    expect(screen.getByTestId('composer-sentence')).toHaveTextContent(
      'Every day, spend 0.100001 USDC to buy WETH.',
    );
    const calldata = screen.getByTestId('live-calldata').textContent as `0x${string}`;
    const decoded = decodeFunctionData({ abi: agentAbi, data: calldata });
    expect(decoded.functionName).toBe('addRule');
    expect(decoded.args?.[0]).toMatchObject({ amountIn: 100_001n, tokenIn: chain.usdc });
  });

  it('accepts a typed limit price and expiry for a price rule', async () => {
    const user = userEvent.setup();
    render(<CreateRuleForm agent={AGENT} initialTemplate={3} />);

    await user.selectOptions(screen.getByLabelText('Pay with'), 'USDC');
    await user.selectOptions(screen.getByLabelText('Receive'), 'WETH');
    await user.type(screen.getByLabelText('Amount to spend'), '1');
    await user.type(screen.getByLabelText('Limit price'), '1400');
    fireEvent.change(screen.getByLabelText('Expires'), {
      target: { value: '2099-01-01T00:00' },
    });

    expect(screen.getByTestId('composer-sentence')).toHaveTextContent('below 1400');
    const decoded = decodeFunctionData({
      abi: agentAbi,
      data: screen.getByTestId('live-calldata').textContent as `0x${string}`,
    });
    expect(decoded.args?.[0]).toMatchObject({
      amountIn: 1_000_000n,
      threshold: 1_400n * 10n ** 18n,
      secondary: BigInt(new Date('2099-01-01T00:00').getTime() / 1_000),
    });
  });

  it('rejects spend above the live vault cap and applies only a quote within that cap', async () => {
    const user = userEvent.setup();
    render(
      <CreateRuleForm
        agent={AGENT}
        vaultTerms={{ tokenIn: chain.usdc, tokenOut: chain.weth, ceiling: 20_000_000n }}
      />,
    );
    await fillTrade(user);
    const amount = screen.getByLabelText('Amount to spend');
    await user.type(amount, '20.01');
    await user.tab();
    expect(amount).toHaveAccessibleDescription('USDC Enter 20 USDC or less per run.');
    expect(screen.queryByTestId('live-calldata')).toBeNull();

    await user.click(screen.getByText('Quote a target receive amount'));
    const target = screen.getByLabelText('Target receive amount');
    mocks.readContract.mockResolvedValueOnce([151_525_484n, 100_000_000_000_000_000n]);
    await user.type(target, '0.1');
    await user.click(screen.getByRole('button', { name: 'Get quote' }));
    expect(await screen.findByText(/costs/, { selector: '[role="status"]' })).toHaveTextContent(
      '0.1 WETH costs 151.525484 USDC. This exceeds the 20 USDC per-run limit.',
    );
    expect(screen.queryByRole('button', { name: /as spend/ })).toBeNull();
    expect(amount).toHaveValue('20.01');

    mocks.readContract.mockResolvedValueOnce([1_500_001n, 1_000_000_000_000_000n]);
    await user.clear(target);
    await user.type(target, '0.001');
    await user.click(screen.getByRole('button', { name: 'Get quote' }));
    await user.click(await screen.findByRole('button', { name: 'Use 1.500001 USDC as spend' }));
    expect(amount).toHaveValue('1.500001');
    expect(screen.getByTestId('composer-sentence')).toHaveTextContent(
      'Every day, spend 1.500001 USDC to buy WETH.',
    );
  });

  it('rechecks the vault before simulating and blocks a spend above a changed cap', async () => {
    const user = userEvent.setup();
    const terms = { tokenIn: chain.usdc, tokenOut: chain.weth, ceiling: 100_000_000n };
    reportVault({ cap: 1_000_000n, balances: [2_000_000n] });
    render(<CreateRuleForm agent={AGENT} vaultTerms={terms} />);
    await fillTrade(user);
    await user.type(screen.getByLabelText('Amount to spend'), '2');
    await user.click(screen.getByRole('button', { name: 'Review and create rule' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your vault allows up to 1 USDC per run.',
    );
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.sendTransactionAsync).not.toHaveBeenCalled();
  });

  it('shows the exact deposit shortfall and skips wallet review when the vault is empty', async () => {
    const user = userEvent.setup();
    reportVault({ balances: [0n] });
    render(
      <MemoryRouter>
        <CreateRuleForm agent={AGENT} />
      </MemoryRouter>,
    );
    await fillTrade(user);
    await user.type(screen.getByLabelText('Amount to spend'), '1');
    await user.click(screen.getByRole('button', { name: 'Review and create rule' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your vault has 0 USDC available. Deposit at least 1 USDC',
    );
    expect(screen.getByRole('link', { name: /Fund your vault/ })).toHaveAttribute(
      'href',
      '/account',
    );
    expect(mocks.requestSignature).not.toHaveBeenCalled();
    expect(mocks.sendTransactionAsync).not.toHaveBeenCalled();
  });

  it('blocks the wallet request if funds are withdrawn during the app review', async () => {
    const user = userEvent.setup();
    reportVault({ balances: [1_000_000n, 500_000n] });
    mocks.requestSignature.mockImplementationOnce(
      async (_details, _signer, sign, _reviewedSetupConnector, beforeSign) => {
        await beforeSign();
        return sign();
      },
    );
    render(
      <MemoryRouter>
        <CreateRuleForm agent={AGENT} />
      </MemoryRouter>,
    );
    await fillTrade(user);
    await user.type(screen.getByLabelText('Amount to spend'), '1');
    await user.click(screen.getByRole('button', { name: 'Review and create rule' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Deposit at least 0.5 USDC');
    expect(mocks.requestSignature).toHaveBeenCalledOnce();
    expect(mocks.sendTransactionAsync).not.toHaveBeenCalled();
  });
});

describe('rule funding by template', () => {
  const transfer = {
    chainId: chain.chainId,
    tokenIn: chain.usdc,
    tokenOut: zeroAddress,
    amountIn: 1_000_000n,
    threshold: 1_000_000n,
    secondary: 0n,
    pair: USER,
  };

  it('allows alerts without reading a vault', async () => {
    await expect(
      assertRuleFunding(AGENT, { ...transfer, template: 13, amountIn: 0n }),
    ).resolves.toBeUndefined();
    expect(mocks.linkedVault).not.toHaveBeenCalled();
  });

  it('credits the qualifying incoming transfer to an Income Sweep', async () => {
    reportVault({ balances: [0n] });
    await expect(assertRuleFunding(AGENT, { ...transfer, template: 8 })).resolves.toBeUndefined();
    await expect(
      assertRuleFunding(AGENT, { ...transfer, template: 8, threshold: 750_000n }),
    ).rejects.toThrow('Deposit at least 0.25 USDC');
  });

  it('reads the source wallet and checks its allowance for Balance Floor', async () => {
    reportVault({ balances: [2_000_000n], allowance: 999_999n });
    await expect(assertRuleFunding(AGENT, { ...transfer, template: 9 })).rejects.toThrow(
      'The source wallet must approve at least 1 USDC',
    );
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'balanceOf', args: [USER] }),
    );
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'allowance', args: [USER, VAULT] }),
    );
  });
});
