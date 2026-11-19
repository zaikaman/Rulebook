import { agentAbi, LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { BaseError, encodeEventTopics, numberToHex, zeroAddress } from 'viem';
import { beforeEach, expect, it, vi } from 'vitest';

import { WalletReviewProvider } from '../src/components/WalletReviewProvider.js';
import { useAccountSetup } from '../src/hooks/useAccountSetup.js';
import { useChainGuard } from '../src/hooks/useChainGuard.js';
import { useRuleControl } from '../src/hooks/useRuleControl.js';
import { useSetupWallet } from '../src/hooks/useSetupWallet.js';
import { DEMO_USDC } from '../src/lib/contracts.js';
import { signatureDetails } from '../src/lib/signatures.js';
import { CreateAccount } from '../src/pages/CreateAccount.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getChainId: vi.fn(),
  getAccounts: vi.fn(),
  request: vi.fn(),
  switchChain: vi.fn(),
  sign: vi.fn(),
  error: vi.fn(),
  readContract: vi.fn(),
  writeContract: vi.fn(),
  receipt: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useConfig: () => ({}),
  useAccount: () => ({ address: OWNER, connector }),
  useBalance: ({ chainId }: { chainId: number }) => ({
    data: { value: chainId === LASNA_CHAIN_ID ? 10n ** 18n : 0n, decimals: 18 },
  }),
  useReadContract: () => ({ data: 0n }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.sign }),
  useWriteContract: () => ({ writeContractAsync: mocks.writeContract }),
}));
vi.mock('../src/components/chrome/WalletControl.js', () => ({
  WalletControl: () => null,
}));
vi.mock('wagmi/actions', () => ({ getAccount: mocks.getAccount }));
vi.mock('../src/lib/contracts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/contracts.js')>()),
  AGENT_FACTORY_ADDRESS: '0xdddddddddddddddddddddddddddddddddddddddd',
  VAULT_FACTORY_ADDRESS: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
}));
vi.mock('../src/lib/wagmi.js', () => ({
  lasnaPublicClient: {
    chain: { id: LASNA_CHAIN_ID },
    getGasPrice: async () => 1n,
    readContract: mocks.readContract,
    waitForTransactionReceipt: mocks.receipt,
  },
  unichainPublicClient: { readContract: mocks.readContract },
}));

const connector = {
  uid: 'wallet',
  type: 'injected',
  getChainId: mocks.getChainId,
  getAccounts: mocks.getAccounts,
  getProvider: async () => ({ request: mocks.request }),
};
const account = (chainId: number, address = OWNER) => ({ chainId, address, connector });

function WriteButton({ reviewedSetupConnector }: { reviewedSetupConnector?: string }) {
  const requestSignature = useChainGuard();
  return (
    <button
      type="button"
      onClick={() => {
        void requestSignature(
          signatureDetails.linkVault(AGENT, VAULT),
          OWNER,
          mocks.sign,
          reviewedSetupConnector,
        ).catch(mocks.error);
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
  mocks.getAccounts.mockResolvedValue([OWNER]);
  mocks.request.mockResolvedValue([
    {
      parentCapability: 'endowment:permitted-chains',
      caveats: [
        {
          type: 'restrictNetworkSwitching',
          value: [numberToHex(LASNA_CHAIN_ID), numberToHex(UNICHAIN_SEPOLIA_CHAIN_ID)],
        },
      ],
    },
  ]);
  mocks.switchChain.mockImplementation(async () => {
    mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID));
    mocks.getChainId.mockResolvedValue(LASNA_CHAIN_ID);
    return { id: LASNA_CHAIN_ID };
  });
});

async function start(reviewedSetupConnector?: string) {
  const user = userEvent.setup();
  render(
    <WalletReviewProvider>
      <WriteButton reviewedSetupConnector={reviewedSetupConnector} />
    </WalletReviewProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Link accounts' }));
  return user;
}

it('stops reviewed setup before switching or signing if the connector changed', async () => {
  await start('previous-connector');
  expect(mocks.error).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringMatching(/wallet changed/i) }),
  );
  expect(mocks.switchChain).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('explains the switch and waits for separate switch and signature confirmations', async () => {
  // An extension can miss a chainChanged event. The live connector must determine the prompt.
  mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID));
  const user = await start();
  const prompt = within(await screen.findByRole('dialog', { name: /switch to reactive lasna/i }));
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
  await screen.findByRole('dialog', { name: /switch to reactive lasna/i });
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Link accounts' })).toHaveFocus();
  expect(mocks.switchChain).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('does not sign after a rejected switch', async () => {
  mocks.switchChain.mockRejectedValue(new Error('Switch rejected'));
  const user = await start();
  await user.click(await screen.findByRole('button', { name: 'Switch to Reactive Lasna' }));
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
  mocks.getChainId.mockResolvedValue(LASNA_CHAIN_ID);
  const user = await start();
  const review = within(await screen.findByRole('dialog', { name: /review.*reactive lasna/i }));
  mocks.getChainId.mockResolvedValue(UNICHAIN_SEPOLIA_CHAIN_ID);
  await user.click(review.getByRole('button', { name: 'Continue to wallet' }));
  expect(mocks.error).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringMatching(/different network/i) }),
  );
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('does not sign if the provider no longer grants access to the reviewed account', async () => {
  mocks.getAccounts.mockResolvedValue([VAULT]);
  const user = await start();
  await user.click(await screen.findByRole('button', { name: 'Switch to Reactive Lasna' }));
  const review = await screen.findByRole('dialog', { name: /review.*reactive lasna/i });
  await user.click(within(review).getByRole('button', { name: 'Continue to wallet' }));
  expect(mocks.error).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'WalletAuthorizationError', chainId: LASNA_CHAIN_ID }),
  );
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('guides recovery from a wallet permission error and retries only the account link', async () => {
  const hash = `0x${'1'.repeat(64)}` as const;
  let linked = false;
  mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID));
  mocks.getChainId.mockResolvedValue(LASNA_CHAIN_ID);
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case 'agentOf':
      case 'agent':
        return AGENT;
      case 'vaultOf':
        return VAULT;
      case 'getVault':
        return linked ? VAULT : zeroAddress;
      default:
        throw new Error(`Unexpected read: ${functionName}`);
    }
  });
  mocks.writeContract
    .mockRejectedValueOnce(
      new BaseError('The requested account and/or method has not been authorized by the user.', {
        cause: Object.assign(new Error('Unauthorized'), { code: 4100 }),
        metaMessages: ['Request Arguments: raw transaction data'],
      }),
    )
    .mockResolvedValueOnce(hash);
  mocks.receipt.mockImplementation(async () => {
    linked = true;
    return {
      status: 'success',
      transactionHash: hash,
      logs: [
        {
          address: AGENT,
          data: '0x',
          topics: encodeEventTopics({
            abi: agentAbi,
            eventName: 'VaultLinked',
            args: { chainId: BigInt(UNICHAIN_SEPOLIA_CHAIN_ID), vault: VAULT },
          }),
        },
      ],
    };
  });

  function Setup() {
    const setup = useAccountSetup({ owner: OWNER, wallet: useSetupWallet() });
    return setup.data?.linked ? (
      <p role="status">Account ready</p>
    ) : (
      <CreateAccount setup={setup} />
    );
  }

  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WalletReviewProvider>
        <MemoryRouter>
          <Setup />
        </MemoryRouter>
      </WalletReviewProvider>
    </QueryClientProvider>,
  );

  const resume = await screen.findByRole('button', { name: 'Continue account setup' });
  await user.click(resume);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/wallet denied access/i);
  expect(alert).toHaveTextContent(/continue account setup/i);
  expect(alert).not.toHaveTextContent('Request Arguments');
  expect(within(alert).getByText('Reactive Lasna')).toBeVisible();
  expect(mocks.receipt).not.toHaveBeenCalled();

  await user.click(within(alert).getByRole('button', { name: 'Refresh wallet access' }));
  expect(await screen.findByText(/wallet access refreshed/i)).toBeVisible();
  expect(mocks.request).toHaveBeenLastCalledWith({
    method: 'wallet_requestPermissions',
    params: [{ eth_accounts: {} }],
  });
  expect(mocks.writeContract).toHaveBeenCalledTimes(1);

  await user.click(resume);
  expect(await screen.findByText('Account ready')).toHaveAttribute('role', 'status');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mocks.sign).not.toHaveBeenCalled();
  expect(mocks.writeContract).toHaveBeenCalledTimes(2);
  expect(mocks.writeContract).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      functionName: 'linkVault',
      connector,
      address: AGENT,
      args: [BigInt(UNICHAIN_SEPOLIA_CHAIN_ID), VAULT],
      chainId: LASNA_CHAIN_ID,
    }),
  );
  expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith({ hash });
});

it('uses the reviewed cap and signer for the mirror write adapter', async () => {
  mocks.getAccount.mockReturnValue(account(LASNA_CHAIN_ID));
  mocks.getChainId.mockResolvedValue(LASNA_CHAIN_ID);
  mocks.writeContract.mockResolvedValue('0x1234');
  mocks.receipt.mockResolvedValue({ status: 'success' });
  const terms = {
    leaderChainId: BigInt(UNICHAIN_SEPOLIA_CHAIN_ID),
    leaderAgent: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
    tokenIn: DEMO_USDC,
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
