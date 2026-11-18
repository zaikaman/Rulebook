import { UNICHAIN_SEPOLIA_CHAIN_ID, getChain } from '@rulebook/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChainSwitchPrompt } from '../src/components/ChainSwitchPrompt.js';
import { SignatureSummary } from '../src/components/SignatureSummary.js';
import { signatureDetails } from '../src/lib/signatures.js';

const AGENT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VAULT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WALLET = '0xcccccccccccccccccccccccccccccccccccccccc';
const FACTORY = '0xdddddddddddddddddddddddddddddddddddddddd';
const effect = 'Buy WETH daily.';
const rule = {
  chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
  tokenIn: getChain(UNICHAIN_SEPOLIA_CHAIN_ID).usdc,
  amountIn: 10_000_000n,
};

describe('SignatureSummary', () => {
  it.each([
    [
      'vault authorization',
      signatureDetails.authorizeVault(FACTORY, AGENT),
      'Unichain Sepolia',
      FACTORY,
      /authorize the sponsor/i,
      /No principal/i,
    ],
    [
      'vault link',
      signatureDetails.linkVault(AGENT, VAULT),
      'Reactive Lasna',
      AGENT,
      /link your funds account/i,
      /No principal/i,
    ],
    [
      'create',
      signatureDetails.create(AGENT, rule, effect, true),
      'Reactive Lasna',
      AGENT,
      /create a rule and publish/i,
      /10 USDC per run/i,
    ],
    [
      'pause',
      signatureDetails.control(AGENT, 'pauseRule', 7n),
      'Reactive Lasna',
      AGENT,
      /pause rule #7/i,
      /No principal/i,
    ],
    [
      'resume',
      signatureDetails.control(AGENT, 'resumeRule', 7n),
      'Reactive Lasna',
      AGENT,
      /resume rule #7/i,
      /No principal/i,
    ],
    [
      'cancel',
      signatureDetails.control(AGENT, 'cancelRule', 7n),
      'Reactive Lasna',
      AGENT,
      /permanently cancel rule #7/i,
      /No principal/i,
    ],
    [
      'reorder',
      signatureDetails.reorder(AGENT, [7n, 2n]),
      'Reactive Lasna',
      AGENT,
      /evaluate rules in this order: #7, #2/i,
      /No principal/i,
    ],
    [
      'withdraw',
      signatureDetails.withdraw(VAULT, WALLET, '2 USDC'),
      'Unichain Sepolia',
      VAULT,
      /send principal/i,
      '2 USDC',
    ],
    [
      'clone',
      signatureDetails.clone(AGENT, rule, effect),
      'Reactive Lasna',
      AGENT,
      /create a private copy/i,
      /10 USDC per run/i,
    ],
    [
      'mirror',
      signatureDetails.mirror(
        AGENT,
        7n,
        { leaderVault: VAULT, leaderRuleId: 2n, scaleBps: 5000, hourlyCap: 3 },
        '4 USDC',
      ),
      'Reactive Lasna',
      AGENT,
      /mirror leader rule #2/i,
      /4 USDC per run/i,
    ],
  ] as const)(
    'identifies the network, target, effect and amount for %s',
    (_label, details, network, target, change, amount) => {
      render(<SignatureSummary details={details} onCancel={vi.fn()} onConfirm={vi.fn()} />);
      const dialog = within(screen.getByRole('dialog', { name: new RegExp(network) }));
      expect(dialog.getByText(network)).toHaveAttribute('data-chain-id', String(details.chainId));
      expect(dialog.getByText(target)).toBeVisible();
      expect(dialog.getByText(change)).toBeVisible();
      expect(dialog.getByText(amount)).toBeVisible();
    },
  );
});

describe.each(['review', 'switch'] as const)('%s prompt accessibility', (prompt) => {
  it('names the network, traps focus in both directions, and cancels with Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const details = signatureDetails.linkVault(AGENT, VAULT);
    render(
      <>
        <button type="button">Outside</button>
        {prompt === 'review' ? (
          <SignatureSummary details={details} onCancel={onCancel} onConfirm={onConfirm} />
        ) : (
          <ChainSwitchPrompt details={details} onCancel={onCancel} onConfirm={onConfirm} />
        )}
      </>,
    );
    const dialog = within(screen.getByRole('dialog', { name: /Reactive Lasna/i }));
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    const confirm = dialog.getByRole('button', {
      name: /continue to wallet|switch to reactive lasna/i,
    });

    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
