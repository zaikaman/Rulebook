/**
 * Hermetic onboarding fixture: one local anvil, the real factories, mock demo tokens, and the
 * real backend with an in-memory store. No public RPC, faucet, or funded wallet is involved.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import { createPublicClient, createWalletClient, http, parseAbi, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createChainClients } from '../../backend/src/chain/clients.js';
import type { AppConfig } from '../../backend/src/config.js';
import { createRepositories } from '../../backend/src/db/repositories/index.js';
import { InMemoryStore } from '../../backend/src/db/store.js';
import { CursorStore } from '../../backend/src/indexer/cursors.js';
import { IndexerPoller } from '../../backend/src/indexer/poller.js';
import { seedMarketplace } from '../../backend/src/marketplace/seed.js';
import { buildServer } from '../../backend/src/server.js';
import { PublicAccountChain } from '../../backend/src/sponsor/accountChain.js';
import {
  createRelayerTransport,
  relayerAddresses,
  relayerOptions,
  SponsorRelayer,
} from '../../backend/src/sponsor/relayer.js';
import {
  AGENT_FACTORY_ADDRESS,
  ANVIL_RPC_PORT,
  ANVIL_RPC_URL,
  FIXTURE_API_PORT,
  FIXTURE_API_URL,
  FIXTURE_FRONTEND_URL,
  SPONSOR_ADDRESS,
  SPONSOR_PRIVATE_KEY,
  VAULT_FACTORY_ADDRESS,
} from './fixtureConfig.js';

interface Artifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
  readonly deployedBytecode: { readonly object: Hex };
}

function artifact(path: string): Artifact {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
  ) as Artifact;
}

const ruleRegistryArtifact = artifact('../../contracts/out/RuleRegistry.sol/RuleRegistry.json');
const agentFactoryArtifact = artifact('../../contracts/out/AgentFactory.sol/AgentFactory.json');
const vaultFactoryArtifact = artifact('../../contracts/out/VaultFactory.sol/VaultFactory.json');
const mockErc20Artifact = artifact('../../contracts/out/MockERC20.sol/MockERC20.json');
const mockSystemArtifact = artifact(
  '../../contracts/out/MockSystemContract.sol/MockSystemContract.json',
);

const anvilChain = {
  id: 1301,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC_URL] } },
} as const;

const ERC20 = parseAbi([
  'function mint(address to, uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
]);

async function waitForAnvil(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(ANVIL_RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return;
    } catch {
      // anvil is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('anvil did not start');
}

async function main(): Promise<void> {
  const anvilPath =
    process.env.ANVIL_PATH ?? (process.platform === 'win32' ? '.tools/foundry/anvil.exe' : 'anvil');
  const anvil: ChildProcess = spawn(
    anvilPath,
    ['--chain-id', '1301', '--port', String(ANVIL_RPC_PORT), '--silent'],
    { stdio: 'inherit' },
  );
  const serverRef: { current?: ReturnType<typeof buildServer>['app'] } = {};

  const shutdown = (): void => {
    void serverRef.current?.close();
    anvil.kill();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await waitForAnvil();

  const account = privateKeyToAccount(SPONSOR_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: anvilChain, transport: http(ANVIL_RPC_URL) });
  const wallet = createWalletClient({
    account,
    chain: anvilChain,
    transport: http(ANVIL_RPC_URL),
  });

  // Lasna's system contract is at a fixed address with no code locally. Installing the double
  // there lets an Agent's subscribe() call succeed, exactly as it does on the real network.
  await publicClient.request({
    method: 'anvil_setCode',
    params: [getChain(LASNA_CHAIN_ID).systemContract, mockSystemArtifact.deployedBytecode.object],
  } as never);

  // The registry is deployed first because every Agent stores its address; the factory nonces
  // in `fixtureConfig.ts` depend on this order.
  const registryTx = await wallet.deployContract({
    abi: ruleRegistryArtifact.abi,
    bytecode: ruleRegistryArtifact.bytecode.object,
    args: [],
  });
  const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryTx });
  const registry = registryReceipt.contractAddress;
  if (!registry) throw new Error('RuleRegistry was not deployed');

  const agentFactoryTx = await wallet.deployContract({
    abi: agentFactoryArtifact.abi,
    bytecode: agentFactoryArtifact.bytecode.object,
    args: [getChain(LASNA_CHAIN_ID).systemContract, registry],
  });
  await publicClient.waitForTransactionReceipt({ hash: agentFactoryTx });
  if (agentFactoryTx) {
    const deployed = await publicClient.getCode({ address: AGENT_FACTORY_ADDRESS });
    if (!deployed) throw new Error('AgentFactory was not deployed at its expected address');
  }

  const vaultFactoryTx = await wallet.deployContract({
    abi: vaultFactoryArtifact.abi,
    bytecode: vaultFactoryArtifact.bytecode.object,
    args: [getChain(UNICHAIN_SEPOLIA_CHAIN_ID).callbackProxy],
  });
  await publicClient.waitForTransactionReceipt({ hash: vaultFactoryTx });

  const usdc = getChain(UNICHAIN_SEPOLIA_CHAIN_ID).usdc;
  const weth = getChain(UNICHAIN_SEPOLIA_CHAIN_ID).weth;
  for (const token of [usdc, weth]) {
    await publicClient.request({
      method: 'anvil_setCode',
      params: [token, mockErc20Artifact.deployedBytecode.object],
    } as never);
  }

  for (const [token, amount] of [
    [usdc, 1_000_000_000_000n],
    [weth, 1_000_000n * 10n ** 18n],
  ] as const) {
    const hash = await wallet.writeContract({
      address: token as Address,
      abi: ERC20,
      functionName: 'mint',
      args: [SPONSOR_ADDRESS, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const config: AppConfig = {
    PORT: FIXTURE_API_PORT,
    NODE_ENV: 'test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    LASNA_RPC_URL: ANVIL_RPC_URL,
    UNICHAIN_RPC_URL: ANVIL_RPC_URL,
    INDEXER_ENABLED: false,
    INDEXER_START_BLOCK_LASNA: 0,
    INDEXER_START_BLOCK_UNICHAIN: 0,
    SPONSOR_PRIVATE_KEY,
    AGENT_FACTORY_ADDRESS,
    VAULT_FACTORY_ADDRESS,
    SPONSOR_GAS_TOP_UP_WEI: '50000000000000000',
    SPONSOR_RESERVE_TARGET_WEI: '1000000000000000',
    STARTER_FUNDS_USDC: '10000000',
    STARTER_FUNDS_WETH: '10000000000000000',
    ONBOARDING_RATE_LIMIT_PER_MINUTE: 50,
    ONBOARDING_DAILY_CAP: 1000,
    corsOrigins: [FIXTURE_FRONTEND_URL],
  };

  const clients = createChainClients(config);
  const store = new InMemoryStore();
  const repositories = createRepositories(store);
  // A fresh marketplace is never empty (SC-013): the clone spec borrows a team rule that
  // already has a published `paramsHash`, exactly as the seeded production catalog does.
  await seedMarketplace(repositories);
  const cursors = new CursorStore(store);
  const addresses = relayerAddresses(config);
  if (!addresses) throw new Error('fixture relayer addresses missing');
  const relayer = new SponsorRelayer(
    createRelayerTransport(config, clients),
    addresses,
    relayerOptions(config),
  );

  const built = buildServer(
    {
      config,
      repositories,
      cursors,
      databaseReachable: async () => true,
      rpcHealth: async () => [
        { chain_id: LASNA_CHAIN_ID, rpc_ok: true },
        { chain_id: UNICHAIN_SEPOLIA_CHAIN_ID, rpc_ok: true },
      ],
      relayer,
      accountChain: new PublicAccountChain(clients),
      onboardingLimiter: { allow: () => true },
    },
    { logger: false },
  );
  serverRef.current = built.app;
  await built.app.listen({ port: FIXTURE_API_PORT, host: '127.0.0.1' });

  // The control and clone stories need the read model the indexer normally supplies. Both
  // configured chains share this anvil, but every contract the fixture exercises (Agent,
  // factory, registry) lives on the Lasna side, and a log only decodes under the chain id whose
  // catalog defines it. Zero confirmations keeps the state visible while the spec still runs.
  const indexer = new IndexerPoller({
    repositories,
    store,
    cursors,
    clients,
    startBlocks: { [LASNA_CHAIN_ID]: 0 },
    confirmationDepth: { [LASNA_CHAIN_ID]: 0 },
    rangeSize: 1_000,
    pollIntervalMs: 500,
  });
  void indexer.run([LASNA_CHAIN_ID]);

  process.stdout.write(`Fixture ready at ${FIXTURE_API_URL}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
