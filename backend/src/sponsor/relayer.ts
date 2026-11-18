import {
  agentAbi,
  agentFactoryAbi,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  vaultFactoryAbi,
} from '@rulebook/shared';
import {
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { clientFor, type ChainClients } from '../chain/clients.js';
import type { AppConfig } from '../config.js';

const SYSTEM_ABI = parseAbi([
  'function depositTo(address target) payable',
  'function reserves(address account) view returns (uint256)',
]);
const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const VAULT_DEPOSIT_ABI = parseAbi(['function deposit(address token, uint256 amount)']);
const APPROVE_SELECTOR = toFunctionSelector('function approve(address,uint256)');
const DEPOSIT_SELECTOR = toFunctionSelector('function deposit(address,uint256)');
const DEPLOYMENT_READ_ATTEMPTS = 7;
const DEPLOYMENT_READ_BACKOFF_MS = 250;

/** Raised before signing when a call is not on the sponsor's selector allowlist (T091). */
export class SelectorNotAllowed extends Error {
  constructor(
    readonly selector: string,
    readonly to: string,
  ) {
    super(`Sponsor relayer refuses selector ${selector} on ${to}`);
    this.name = 'SelectorNotAllowed';
  }
}

export class RelayerNotConfigured extends Error {
  constructor() {
    super('The sponsor relayer is not configured in this environment.');
    this.name = 'RelayerNotConfigured';
  }
}

/** The contract addresses the sponsor is allowed to touch. No admin address appears here. */
export interface RelayerAddresses {
  readonly agentFactory: Address;
  readonly vaultFactory: Address;
  readonly systemContract: Address;
  readonly usdc: Address;
  readonly weth: Address;
}

export interface RelayerReceipt {
  readonly status: 'success' | 'reverted';
  readonly blockNumber: number;
}

/** Narrow chain surface, injected so the relayer is testable without RPC or a real key. */
export interface RelayerTransport {
  sendTransaction(input: {
    readonly chainId: number;
    readonly to: Address;
    readonly data: Hex;
    readonly value: bigint;
  }): Promise<Hex>;
  waitForReceipt(chainId: number, hash: Hex): Promise<RelayerReceipt>;
  readAgentOf(factory: Address, owner: Address): Promise<Address | null>;
  readVaultOf(factory: Address, owner: Address): Promise<Address | null>;
  readVaultOwner(vault: Address): Promise<Address | null>;
  readAgentVault(agent: Address, chainId: number): Promise<Address | null>;
  readReserves(systemContract: Address, account: Address): Promise<bigint>;
  readNativeBalance(address: Address): Promise<bigint>;
}

export interface RelayerOptions {
  readonly gasTopUpWei: bigint;
  readonly reserveTargetWei: bigint;
  readonly starterUsdc: bigint;
  readonly starterWeth: bigint;
}

export interface Deployment {
  readonly address: Address;
  readonly txHash: Hex;
  readonly blockNumber: number;
}

export interface StarterFundsTransfer {
  readonly txHashes: Hex[];
  readonly amountUsdc: bigint;
  readonly amountWeth: bigint;
}

/**
 * The only key in the system. It can deploy a user's contracts, add execution credit, top up
 * Lasna gas, and send demo tokens — and it cannot call anything else. It is never an owner,
 * never a Vault agent, and never has a withdrawal path (ADR 0003).
 */
export class SponsorRelayer {
  private readonly allowlist: ReadonlyMap<string, ReadonlySet<string>>;

  constructor(
    private readonly transport: RelayerTransport,
    private readonly addresses: RelayerAddresses,
    private readonly options: RelayerOptions,
  ) {
    this.allowlist = new Map([
      [
        addresses.agentFactory.toLowerCase(),
        new Set([toFunctionSelector('function deploy(address)')]),
      ],
      [
        addresses.vaultFactory.toLowerCase(),
        new Set([
          toFunctionSelector('function deploy(address,address,address,address,uint256,bytes)'),
          toFunctionSelector(
            'function deployMirror(address,address,address,address,uint256,bytes)',
          ),
        ]),
      ],
      [
        addresses.systemContract.toLowerCase(),
        new Set([toFunctionSelector('function depositTo(address)')]),
      ],
      [addresses.usdc.toLowerCase(), new Set([APPROVE_SELECTOR])],
      [addresses.weth.toLowerCase(), new Set([APPROVE_SELECTOR])],
    ]);
  }

  /** Throws unless `(to, selector)` is one of the five allowed operations. */
  assertCallAllowed(to: Address, data: Hex): void {
    const selector = data.length >= 10 ? data.slice(0, 10).toLowerCase() : '0x';
    const allowed = this.allowlist.get(to.toLowerCase());
    if (!allowed?.has(selector)) throw new SelectorNotAllowed(selector, to);
  }

  async agentOf(owner: Address): Promise<Address | null> {
    return this.transport.readAgentOf(this.addresses.agentFactory, owner);
  }

  async vaultOf(owner: Address): Promise<Address | null> {
    return this.transport.readVaultOf(this.addresses.vaultFactory, owner);
  }

  async vaultOwner(vault: Address): Promise<Address | null> {
    return this.transport.readVaultOwner(vault);
  }

  async agentLink(agent: Address, chainId: number): Promise<Address | null> {
    return this.transport.readAgentVault(agent, chainId);
  }

  /** Deploys the Agent with `owner` as its owner; the relayer never becomes owner. */
  async deployAgent(owner: Address): Promise<Deployment> {
    const data = encodeFunctionData({
      abi: agentFactoryAbi,
      functionName: 'deploy',
      args: [owner],
    });
    const txHash = await this.send(LASNA_CHAIN_ID, this.addresses.agentFactory, data, 0n);
    const receipt = await this.wait(LASNA_CHAIN_ID, txHash);
    const agent = await this.readDeploymentRecord(() =>
      this.transport.readAgentOf(this.addresses.agentFactory, owner),
    );
    if (!agent) throw new Error('Agent deployment confirmed without an agentOf record');
    return { address: agent, txHash, blockNumber: receipt.blockNumber };
  }

  /** Deploys the Vault with `owner` as owner and `agent` as its only callback sender. */
  async deployVault(
    owner: Address,
    agent: Address,
    deadline: bigint,
    authorization: Hex,
    mirror = false,
  ): Promise<Deployment> {
    const data = encodeFunctionData({
      abi: vaultFactoryAbi,
      functionName: mirror ? 'deployMirror' : 'deploy',
      args: [owner, agent, this.addresses.usdc, this.addresses.weth, deadline, authorization],
    });
    const txHash = await this.send(
      UNICHAIN_SEPOLIA_CHAIN_ID,
      this.addresses.vaultFactory,
      data,
      0n,
    );
    const receipt = await this.wait(UNICHAIN_SEPOLIA_CHAIN_ID, txHash);
    const vault = await this.readDeploymentRecord(() =>
      this.transport.readVaultOf(this.addresses.vaultFactory, owner),
    );
    if (!vault) throw new Error('Vault deployment confirmed without a vaultOf record');
    return { address: vault, txHash, blockNumber: receipt.blockNumber };
  }

  /**
   * Credits the Agent's execution reserves with `depositTo`, which settles debt first. Returns
   * null when reserves already meet the target, so repeated onboarding does not spend twice.
   */
  async fundAgentReserves(agent: Address): Promise<{ txHash: Hex; blockNumber: number } | null> {
    const reserves = await this.transport.readReserves(this.addresses.systemContract, agent);
    if (reserves >= this.options.reserveTargetWei) return null;
    const data = encodeFunctionData({
      abi: SYSTEM_ABI,
      functionName: 'depositTo',
      args: [agent],
    });
    const txHash = await this.send(
      LASNA_CHAIN_ID,
      this.addresses.systemContract,
      data,
      this.options.reserveTargetWei - reserves,
    );
    const receipt = await this.wait(LASNA_CHAIN_ID, txHash);
    return { txHash, blockNumber: receipt.blockNumber };
  }

  /**
   * Sends the user a capped amount of native Lasna gas so they can sign their own config
   * transactions (IDEA.md §12 v1). Null when the balance already covers the target.
   */
  async topUpUserGas(owner: Address): Promise<{ txHash: Hex; blockNumber: number } | null> {
    const balance = await this.transport.readNativeBalance(owner);
    if (balance >= this.options.gasTopUpWei) return null;
    const txHash = await this.sendNative(owner, this.options.gasTopUpWei - balance);
    const receipt = await this.wait(LASNA_CHAIN_ID, txHash);
    return { txHash, blockNumber: receipt.blockNumber };
  }

  /**
   * Funds the vault through `approve` + `deposit`, not a plain transfer: only `deposit`
   * records principal, and principal is what the owner can withdraw and what rules may spend.
   * No token other than the configured demo pair is reachable.
   */
  async sendStarterFunds(vault: Address): Promise<StarterFundsTransfer> {
    const txHashes: Hex[] = [];
    const transfers: Array<[Address, bigint]> = [
      [this.addresses.usdc, this.options.starterUsdc],
      [this.addresses.weth, this.options.starterWeth],
    ];
    for (const [token, amount] of transfers) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vault, amount],
      });
      txHashes.push(await this.send(UNICHAIN_SEPOLIA_CHAIN_ID, token, approveData, 0n));

      const depositData = encodeFunctionData({
        abi: VAULT_DEPOSIT_ABI,
        functionName: 'deposit',
        args: [token, amount],
      });
      txHashes.push(await this.sendVaultDeposit(vault, depositData));
    }
    return {
      txHashes,
      amountUsdc: this.options.starterUsdc,
      amountWeth: this.options.starterWeth,
    };
  }

  /** Every contract call goes through here, so no path can skip the allowlist. */
  private async send(chainId: number, to: Address, data: Hex, value: bigint): Promise<Hex> {
    this.assertCallAllowed(to, data);
    return this.transport.sendTransaction({ chainId, to, data, value });
  }

  /** Native transfers exist only for the capped Lasna gas top-up, never as a general call. */
  private async sendNative(to: Address, value: bigint): Promise<Hex> {
    return this.transport.sendTransaction({ chainId: LASNA_CHAIN_ID, to, data: '0x', value });
  }

  /** Some RPC gateways lag the receipt's head when a post-deployment mapping is read. */
  private async readDeploymentRecord(read: () => Promise<Address | null>): Promise<Address | null> {
    for (let attempt = 0; attempt < DEPLOYMENT_READ_ATTEMPTS; attempt += 1) {
      const value = await read();
      if (value) return value;
      if (attempt + 1 < DEPLOYMENT_READ_ATTEMPTS) {
        const delay = Math.min(DEPLOYMENT_READ_BACKOFF_MS * 2 ** attempt, 2_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return null;
  }

  /** A vault deposit is allowed only on the vault being funded, never on an arbitrary one. */
  private async sendVaultDeposit(vault: Address, data: Hex): Promise<Hex> {
    if (data.slice(0, 10).toLowerCase() !== DEPOSIT_SELECTOR) {
      throw new SelectorNotAllowed(data.slice(0, 10), vault);
    }
    return this.transport.sendTransaction({
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      to: vault,
      data,
      value: 0n,
    });
  }

  private async wait(chainId: number, hash: Hex): Promise<RelayerReceipt> {
    const receipt = await this.transport.waitForReceipt(chainId, hash);
    if (receipt.status !== 'success') throw new Error(`Sponsor transaction ${hash} reverted`);
    return receipt;
  }
}

/** The public surface the onboarding routes depend on; tests can provide a fake. */
export type OnboardingRelayer = Pick<
  SponsorRelayer,
  | 'agentOf'
  | 'vaultOf'
  | 'vaultOwner'
  | 'agentLink'
  | 'deployAgent'
  | 'deployVault'
  | 'fundAgentReserves'
  | 'topUpUserGas'
  | 'sendStarterFunds'
>;

/** Builds the allowlisted addresses from config and the one shared chain config. */
export function relayerAddresses(config: AppConfig): RelayerAddresses | null {
  if (!config.AGENT_FACTORY_ADDRESS || !config.VAULT_FACTORY_ADDRESS) return null;
  const lasna = getChain(LASNA_CHAIN_ID);
  const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
  return {
    agentFactory: config.AGENT_FACTORY_ADDRESS as Address,
    vaultFactory: config.VAULT_FACTORY_ADDRESS as Address,
    systemContract: lasna.systemContract,
    usdc: unichain.usdc,
    weth: unichain.weth,
  };
}

export function relayerOptions(config: AppConfig): RelayerOptions {
  return {
    gasTopUpWei: BigInt(config.SPONSOR_GAS_TOP_UP_WEI),
    reserveTargetWei: BigInt(config.SPONSOR_RESERVE_TARGET_WEI),
    starterUsdc: BigInt(config.STARTER_FUNDS_USDC),
    starterWeth: BigInt(config.STARTER_FUNDS_WETH),
  };
}

/** Production transport: one wallet client per chain, reads through the public clients. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// Lasna's RPC reports a zero priority fee, but validators require a 1-wei tip.
const LASNA_MIN_PRIORITY_FEE_PER_GAS = 1n;

/** A missing mapping entry reads as the zero address; onboarding treats it as absent. */
function normalize(value: Address | null): Address | null {
  return value && value !== ZERO_ADDRESS ? value : null;
}

export function createRelayerTransport(config: AppConfig, clients: ChainClients): RelayerTransport {
  if (!config.SPONSOR_PRIVATE_KEY) throw new RelayerNotConfigured();
  const account = privateKeyToAccount(config.SPONSOR_PRIVATE_KEY as Hex);
  // No `chain` on the wallet clients: the transport's RPC is authoritative, and attaching a
  // chain makes viem reject a locally simulated destination whose RPC reports another id.
  const lasnaWallet = createWalletClient({
    account,
    transport: http(config.LASNA_RPC_URL),
  });
  const unichainWallet = createWalletClient({
    account,
    transport: http(config.UNICHAIN_RPC_URL),
  });

  const read = async <T>(
    chainId: number,
    call: (client: PublicClient) => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    try {
      return await call(clientFor(clients, chainId));
    } catch {
      return fallback;
    }
  };

  return {
    sendTransaction: async ({ chainId, to, data, value }) => {
      const wallet = chainId === LASNA_CHAIN_ID ? lasnaWallet : unichainWallet;
      return wallet.sendTransaction({
        account,
        chain: null,
        to,
        data,
        value,
        ...(chainId === LASNA_CHAIN_ID
          ? { maxPriorityFeePerGas: LASNA_MIN_PRIORITY_FEE_PER_GAS }
          : {}),
      });
    },
    waitForReceipt: async (chainId, hash) => {
      const receipt = await clientFor(clients, chainId).waitForTransactionReceipt({ hash });
      return {
        status: receipt.status,
        blockNumber: Number(receipt.blockNumber),
      };
    },
    readAgentOf: async (factory, owner) =>
      normalize(
        await read<Address | null>(
          LASNA_CHAIN_ID,
          (client) =>
            client.readContract({
              address: factory,
              abi: agentFactoryAbi,
              functionName: 'agentOf',
              args: [owner],
            }),
          null,
        ),
      ),
    readVaultOf: async (factory, owner) =>
      normalize(
        await read<Address | null>(
          UNICHAIN_SEPOLIA_CHAIN_ID,
          (client) =>
            client.readContract({
              address: factory,
              abi: vaultFactoryAbi,
              functionName: 'vaultOf',
              args: [owner],
            }),
          null,
        ),
      ),
    readVaultOwner: async (vault) =>
      normalize(
        await read<Address | null>(
          UNICHAIN_SEPOLIA_CHAIN_ID,
          (client) => client.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' }),
          null,
        ),
      ),
    readAgentVault: async (agent, chainId) =>
      normalize(
        await read<Address | null>(
          LASNA_CHAIN_ID,
          (client) =>
            client.readContract({
              address: agent,
              abi: agentAbi,
              functionName: 'getVault',
              args: [BigInt(chainId)],
            }),
          null,
        ),
      ),
    readReserves: (systemContract, account) =>
      read(
        LASNA_CHAIN_ID,
        (client) =>
          client.readContract({
            address: systemContract,
            abi: SYSTEM_ABI,
            functionName: 'reserves',
            args: [account],
          }),
        0n,
      ),
    readNativeBalance: (address) =>
      read(LASNA_CHAIN_ID, (client) => client.getBalance({ address }), 0n),
  };
}
