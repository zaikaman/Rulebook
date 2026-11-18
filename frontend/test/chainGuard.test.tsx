import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { WalletReviewProvider } from '../src/components/WalletReviewProvider.js';
import { useChainGuard } from '../src/hooks/useChainGuard.js';
import { useRuleControl } from '../src/hooks/useRuleControl.js';
import { DEMO_USDC } from '../src/lib/contracts.js';
import { signatureDetails } from '../src/lib/signatures.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getChainId: vi.fn(),
  switchChain: vi.fn(),
  sign: vi.fn(),
  error: vi.fn(),
  writeContract: vi.fn(),
  receipt: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useConfig: () => ({}),
  useAccount: () => ({ address: OWNER }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
  useWriteContract: () => ({ writeContractAsync: mocks.writeContract }),
}));
vi.mock('wagmi/actions', () => ({ getAccount: mocks.getAccount }));
vi.mock('../src/lib/wagmi.js', () => ({
  lasnaPublicClient: { waitForTransactionReceipt: mocks.receipt },
}));

const connector = { uid: 'wallet', getChainId: mocks.getChainId };
const account = (chainId: number, address = OWNER) => ({ chainId, address, connector });

function WriteButton() {
  const requestSignature = useChainGuard();
  return (
    <button
      type="button"
      onClick={() => {
        void requestSignature(signatureDetails.linkVault(AGENT, VAULT), OWNER, mocks.sign).catch(
          mocks.error,
        );
      }}
    >
      Link accounts
    </button>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAccount.mockReturnValue(account(UNICHAIN_SEPOLIA_CHAIN_ID));
  mocks.getChainId.mockResolvedValue(UNICHAIN_SEPOLIA_CHAIN_ID);
  mocks.switchChain.mockImplementation(async () => {
    mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID));
    mocks.getChainId.mockResolvedValue(LASNA_CHAIN_ID);
    return { id: LASNA_CHAIN_ID };
  });
});

async function start() {
  const user = userEvent.setup();
  render(
    <WalletReviewProvider>
      <WriteButton />
    </WalletReviewProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Link accounts' }));
  return user;
}

it('explains the switch and waits for separate switch and signature confirmations', async () => {
  const user = await start();
  const prompt = within(screen.getByRole('dialog', { name: /switch to reactive lasna/i }));
  expect(prompt.getByText(/because it targets your automation account/i)).toBeVisible();
  expect(prompt.getByText(/link your funds account/i)).toBeVisible();
  expect(mocks.switchChain).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();

  await user.click(prompt.getByRole('button', { name: 'Switch to Reactive Lasna' }));
  expect(mocks.switchChain).toHaveBeenCalledWith(
    expect.objectContaining({ chainId: LASNA_CHAIN_ID }),
  );
  const review = within(await screen.findByRole('dialog', { name: /review.*reactive lasna/i }));
  expect(mocks.sign).not.toHaveBeenCalled();
  await user.click(review.getByRole('button', { name: 'Continue to wallet' }));
  expect(mocks.sign).toHaveBeenCalledOnce();
});

it('cancels the switch with Escape and returns focus without contacting the wallet', async () => {
  const user = await start();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Link accounts' })).toHaveFocus();
  expect(mocks.switchChain).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('does not sign after a rejected switch', async () => {
  mocks.switchChain.mockRejectedValue(new Error('Switch rejected'));
  const user = await start();
  await user.click(screen.getByRole('button', { name: 'Switch to Reactive Lasna' }));
  expect(mocks.error).toHaveBeenCalledWith(new Error('Switch rejected'));
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('does not sign if the wallet account changes after opening the review', async () => {
  mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID));
  mocks.getChainId.mockResolvedValue(LASNA_CHAIN_ID);
  const user = await start();
  const review = within(await screen.findByRole('dialog', { name: /review.*reactive lasna/i }));
  mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID, VAULT));
  await user.click(review.getByRole('button', { name: 'Continue to wallet' }));
  expect(mocks.error).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringMatching(/wallet.*changed/i) }),
  );
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('does not sign if the wallet changes networks after opening the review', async () => {
  mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID));
  const user = await start();
  const review = within(await screen.findByRole('dialog', { name: /review.*reactive lasna/i }));
  await user.click(review.getByRole('button', { name: 'Continue to wallet' }));
  expect(mocks.error).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringMatching(/different network/i) }),
  );
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('uses the reviewed cap and signer for the mirror write adapter', async () => {
  mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID));
  mocks.getChainId.mockResolvedValue(LASNA_CHAIN_ID);
  mocks.writeContract.mockResolvedValue('0x1234');
  mocks.receipt.mockResolvedValue({ status: 'success' });
  const terms = {
    leaderChainId: BigInt(UNICHAIN_SEPOLIA_CHAIN_ID),
    leaderVault: VAULT,
    leaderRuleId: 2n,
    scaleBps: 5000,
    perRunCap: 4_000_000n,
    hourlyCap: 3,
  };
  function MirrorButton() {
    const { attachMirror } = useRuleControl(AGENT);
    return (
      <button
        type="button"
        onClick={() => {
          void attachMirror(7n, terms, UNICHAIN_SEPOLIA_CHAIN_ID, DEMO_USDC).catch(mocks.error);
        }}
      >
        Attach mirror
      </button>
    );
  }
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WalletReviewProvider>
        <MirrorButton />
      </WalletReviewProvider>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Attach mirror' }));
  const review = within(screen.getByRole('dialog', { name: /review.*reactive lasna/i }));
  expect(review.getByText(/up to 4 usdc per run/i)).toBeVisible();
  expect(mocks.writeContract).not.toHaveBeenCalled();
  await user.click(review.getByRole('button', { name: 'Continue to wallet' }));
  expect(mocks.writeContract).toHaveBeenCalledWith(
    expect.objectContaining({
      account: OWNER,
      address: AGENT,
      chainId: LASNA_CHAIN_ID,
      functionName: 'addMirror',
      args: [7n, terms],
    }),
  );
  expect(mocks.receipt).toHaveBeenCalledWith({ hash: '0x1234' });
});
