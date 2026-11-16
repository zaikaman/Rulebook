import { toFunctionSelector, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  SelectorNotAllowed,
  SponsorRelayer,
  type RelayerAddresses,
  type RelayerTransport,
} from '../../src/sponsor/relayer.js';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const AGENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
const VAULT = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
const HASH = `0x${'d'.repeat(64)}` as Hex;
const SIGNATURE = `0x${'1'.repeat(130)}` as Hex;
const DEADLINE = 2_000_000_000n;

const ADDRESSES: RelayerAddresses = {
  agentFactory: '0x1111111111111111111111111111111111111111',
  vaultFactory: '0x2222222222222222222222222222222222222222',
  systemContract: '0x3333333333333333333333333333333333333333',
  usdc: '0x4444444444444444444444444444444444444444',
  weth: '0x5555555555555555555555555555555555555555',
};

interface Sent {
  readonly chainId: number;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

function makeHarness(overrides: Partial<RelayerTransport> = {}) {
  const sent: Sent[] = [];
  const transport: RelayerTransport = {
    sendTransaction: async (input) => {
      sent.push(input);
      return HASH;
    },
    waitForReceipt: async () => ({ status: 'success', blockNumber: 10 }),
    readAgentOf: async () => null,
    readVaultOf: async () => null,
    readVaultOwner: async () => null,
    readAgentVault: async () => null,
    readReserves: async () => 0n,
    readNativeBalance: async () => 0n,
    ...overrides,
  };
  const relayer = new SponsorRelayer(transport, ADDRESSES, {
    gasTopUpWei: 50n,
    reserveTargetWei: 200n,
    starterUsdc: 10n,
    starterWeth: 2n,
  });
  return { relayer, sent };
}

describe('sponsor relayer allowlist', () => {
  it('allows only the five declared operations', () => {
    const { relayer } = makeHarness();
    relayer.assertCallAllowed(
      ADDRESSES.agentFactory,
      toFunctionSelector('function deploy(address)'),
    );
    relayer.assertCallAllowed(
      ADDRESSES.vaultFactory,
      toFunctionSelector('function deploy(address,address,address,address,uint256,bytes)'),
    );
    relayer.assertCallAllowed(
      ADDRESSES.systemContract,
      toFunctionSelector('function depositTo(address)'),
    );
    relayer.assertCallAllowed(
      ADDRESSES.usdc,
      toFunctionSelector('function approve(address,uint256)'),
    );
    relayer.assertCallAllowed(
      ADDRESSES.weth,
      toFunctionSelector('function approve(address,uint256)'),
    );

    expect(() => relayer.assertCallAllowed(ADDRESSES.agentFactory, '0x')).toThrow(
      SelectorNotAllowed,
    );
    expect(() =>
      relayer.assertCallAllowed(OWNER, toFunctionSelector('function transfer(address,uint256)')),
    ).toThrow(SelectorNotAllowed);
    // The Vault has an owner-only withdraw path; the sponsor key can never encode it.
    expect(() =>
      relayer.assertCallAllowed(
        ADDRESSES.vaultFactory,
        toFunctionSelector('function withdraw(address,uint256,address)'),
      ),
    ).toThrow(SelectorNotAllowed);
  });

  it('deployAgent sends deploy(owner) to the AgentFactory only', async () => {
    const { relayer, sent } = makeHarness({ readAgentOf: async () => AGENT });
    const deployment = await relayer.deployAgent(OWNER);

    expect(deployment.address).toBe(AGENT);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(ADDRESSES.agentFactory);
    expect(sent[0]?.data.startsWith(toFunctionSelector('function deploy(address)'))).toBe(true);
    expect(sent[0]?.value).toBe(0n);
  });

  it('waits for the factory read model to catch up with a confirmed deployment', async () => {
    let reads = 0;
    const { relayer } = makeHarness({
      readAgentOf: async () => {
        reads += 1;
        return reads < 2 ? null : AGENT;
      },
    });
    const deployment = await relayer.deployAgent(OWNER);

    expect(deployment.address).toBe(AGENT);
    expect(reads).toBe(2);
  });

  it('deployVault passes the owner signature, agent, deadline, and allowlisted pair', async () => {
    const { relayer, sent } = makeHarness({ readVaultOf: async () => VAULT });
    const deployment = await relayer.deployVault(OWNER, AGENT, DEADLINE, SIGNATURE);

    expect(deployment.address).toBe(VAULT);
    expect(sent[0]?.to).toBe(ADDRESSES.vaultFactory);
    expect(
      sent[0]?.data.startsWith(
        toFunctionSelector('function deploy(address,address,address,address,uint256,bytes)'),
      ),
    ).toBe(true);
  });

  it('fundAgentReserves deposits only the shortfall and skips when funded', async () => {
    const funded = makeHarness({ readReserves: async () => 200n });
    expect(await funded.relayer.fundAgentReserves(AGENT)).toBeNull();
    expect(funded.sent).toHaveLength(0);

    const shortfall = makeHarness({ readReserves: async () => 120n });
    await shortfall.relayer.fundAgentReserves(AGENT);
    expect(shortfall.sent[0]?.value).toBe(80n);
    expect(shortfall.sent[0]?.to).toBe(ADDRESSES.systemContract);
  });

  it('topUpUserGas sends only the capped shortfall, and nothing when already funded', async () => {
    const funded = makeHarness({ readNativeBalance: async () => 50n });
    expect(await funded.relayer.topUpUserGas(OWNER)).toBeNull();
    expect(funded.sent).toHaveLength(0);

    const shortfall = makeHarness({ readNativeBalance: async () => 20n });
    await shortfall.relayer.topUpUserGas(OWNER);
    expect(shortfall.sent[0]).toMatchObject({ to: OWNER, value: 30n, data: '0x' });
  });

  it('sendStarterFunds approves and deposits exactly USDC and WETH into the vault', async () => {
    const { relayer, sent } = makeHarness();
    const transfer = await relayer.sendStarterFunds(VAULT);

    expect(transfer.txHashes).toHaveLength(4);
    expect(sent.map((tx) => tx.to)).toEqual([ADDRESSES.usdc, VAULT, ADDRESSES.weth, VAULT]);
    expect(sent.map((tx) => tx.data.slice(0, 10))).toEqual([
      toFunctionSelector('function approve(address,uint256)'),
      toFunctionSelector('function deposit(address,uint256)'),
      toFunctionSelector('function approve(address,uint256)'),
      toFunctionSelector('function deposit(address,uint256)'),
    ]);
  });

  it('refuses a deposit on any vault other than the one being funded', async () => {
    const { relayer } = makeHarness();
    // The only deposit path is private and bound to `sendStarterFunds`; a direct call with
    // the wrong selector on a vault is never allowed by the public allowlist.
    expect(() =>
      relayer.assertCallAllowed(VAULT, toFunctionSelector('function deposit(address,uint256)')),
    ).toThrow(SelectorNotAllowed);
  });

  it('refuses a reverted sponsor receipt instead of reporting success', async () => {
    const { relayer } = makeHarness({
      readAgentOf: async () => AGENT,
      waitForReceipt: async () => ({ status: 'reverted', blockNumber: 10 }),
    });
    await expect(relayer.deployAgent(OWNER)).rejects.toThrow('reverted');
  });
});
