/**
 * Hermetic workflow fixture: one local anvil, the V2 factories, mock demo tokens, and the real
 * backend with an in-memory database. No public RPC, faucet, or funded wallet is involved.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BASE_SEPOLIA_CHAIN_ID,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPublicClient, createWalletClient, http, parseAbi, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createChainClients } from '../../backend/src/chain/clients.js';
import type { AppConfig } from '../../backend/src/config.js';
import { buildServer } from '../../backend/src/server.js';
import { registerWorkflowV2Routes } from '../../backend/src/workflows/routesV2.js';
import {
  ANVIL_BASE_RPC_PORT,
  ANVIL_BASE_RPC_URL,
  ANVIL_LASNA_RPC_PORT,
  ANVIL_LASNA_RPC_URL,
  ANVIL_RPC_PORT,
  ANVIL_RPC_URL,
  FIXTURE_API_PORT,
  FIXTURE_API_URL,
  FIXTURE_FRONTEND_URL,
  SPONSOR_PRIVATE_KEY,
  USER_ADDRESS,
  WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
  WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS,
  WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
} from './fixtureConfig.js';

interface Artifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
  readonly deployedBytecode: { readonly object: Hex };
}

function emptyWorkflowV2Database() {
  const query = () => {
    const result = { data: [], error: null };
    const builder = {
      select: () => builder,
      match: () => builder,
      eq: () => builder,
      in: () => builder,
      or: () => builder,
      ilike: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  };
  return {
    from: query,
    // The health endpoint reads one filtered aggregate result and has no rows in this fixture.
    rpc: async () => ({ data: [], error: null }),
  } as unknown as SupabaseClient;
}

function artifact(path: string): Artifact {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
  ) as Artifact;
}

const workflowAgentFactoryV2Artifact = artifact(
  '../../contracts/out/WorkflowAgentFactoryV2.sol/WorkflowAgentFactoryV2.json',
);
const workflowVaultFactoryV2Artifact = artifact(
  '../../contracts/out/WorkflowVaultFactoryV2.sol/WorkflowVaultFactoryV2.json',
);
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

const baseAnvilChain = {
  id: 84532,
  name: 'Base Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_BASE_RPC_URL] } },
} as const;

const lasnaAnvilChain = {
  id: LASNA_CHAIN_ID,
  name: 'Lasna Anvil',
  nativeCurrency: { name: 'Lasna REACT', symbol: 'lREACT', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_LASNA_RPC_URL] } },
} as const;

const ERC20 = parseAbi([
  'function mint(address to, uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
]);

async function waitForAnvil(url: string): Promise<void> {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return;
    } catch {
      // anvil is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`anvil did not start at ${url}`);
}

async function main(): Promise<void> {
  const defaultAnvil = join(
    homedir(),
    '.foundry',
    'bin',
    process.platform === 'win32' ? 'anvil.exe' : 'anvil',
  );
  const anvilPath =
    process.env.ANVIL_PATH?.trim() || (existsSync(defaultAnvil) ? defaultAnvil : 'anvil');
  const anvil: ChildProcess = spawn(
    anvilPath,
    ['--chain-id', '1301', '--port', String(ANVIL_RPC_PORT), '--silent'],
    { stdio: 'inherit' },
  );
  const baseAnvil: ChildProcess = spawn(
    anvilPath,
    ['--chain-id', '84532', '--port', String(ANVIL_BASE_RPC_PORT), '--silent'],
    { stdio: 'inherit' },
  );
  const lasnaAnvil: ChildProcess = spawn(
    anvilPath,
    ['--chain-id', String(LASNA_CHAIN_ID), '--port', String(ANVIL_LASNA_RPC_PORT), '--silent'],
    { stdio: 'inherit' },
  );
  const serverRef: { current?: ReturnType<typeof buildServer>['app'] } = {};

  const shutdown = (): void => {
    serverRef.current?.closeAllConnections?.();
    void serverRef.current?.close();
    anvil.kill();
    baseAnvil.kill();
    lasnaAnvil.kill();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await Promise.all([
      waitForAnvil(ANVIL_RPC_URL),
      waitForAnvil(ANVIL_BASE_RPC_URL),
      waitForAnvil(ANVIL_LASNA_RPC_URL),
    ]);

    const account = privateKeyToAccount(SPONSOR_PRIVATE_KEY);
    const publicClient = createPublicClient({ chain: anvilChain, transport: http(ANVIL_RPC_URL) });
    const wallet = createWalletClient({
      account,
      chain: anvilChain,
      transport: http(ANVIL_RPC_URL),
    });
    const basePublicClient = createPublicClient({
      chain: baseAnvilChain,
      transport: http(ANVIL_BASE_RPC_URL),
    });
    const baseWallet = createWalletClient({
      account,
      chain: baseAnvilChain,
      transport: http(ANVIL_BASE_RPC_URL),
    });
    const lasnaPublicClient = createPublicClient({
      chain: lasnaAnvilChain,
      transport: http(ANVIL_LASNA_RPC_URL),
    });
    const lasnaWallet = createWalletClient({
      account,
      chain: lasnaAnvilChain,
      transport: http(ANVIL_LASNA_RPC_URL),
    });

    // Lasna's system contract and destination callback proxies have no code on clean anvils.
    await Promise.all([
      lasnaPublicClient.request({
        method: 'anvil_setCode',
        params: [
          getChain(LASNA_CHAIN_ID).systemContract,
          mockSystemArtifact.deployedBytecode.object,
        ],
      } as never),
      publicClient.request({
        method: 'anvil_setCode',
        params: [
          getChain(UNICHAIN_SEPOLIA_CHAIN_ID).callbackProxy,
          mockSystemArtifact.deployedBytecode.object,
        ],
      } as never),
      basePublicClient.request({
        method: 'anvil_setCode',
        params: [
          getChain(BASE_SEPOLIA_CHAIN_ID).callbackProxy,
          mockSystemArtifact.deployedBytecode.object,
        ],
      } as never),
    ]);

    await Promise.all([
      (async () => {
        const hash = await lasnaWallet.deployContract({
          abi: workflowAgentFactoryV2Artifact.abi,
          bytecode: workflowAgentFactoryV2Artifact.bytecode.object,
          args: [getChain(LASNA_CHAIN_ID).systemContract],
        });
        const receipt = await lasnaPublicClient.waitForTransactionReceipt({ hash });
        if (
          receipt.contractAddress?.toLowerCase() !== WORKFLOW_V2_AGENT_FACTORY_ADDRESS.toLowerCase()
        ) {
          throw new Error('V2 workflow agent factory was not deployed at its expected address');
        }
      })(),
      (async () => {
        const hash = await wallet.deployContract({
          abi: workflowVaultFactoryV2Artifact.abi,
          bytecode: workflowVaultFactoryV2Artifact.bytecode.object,
          args: [],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (
          receipt.contractAddress?.toLowerCase() !== WORKFLOW_V2_VAULT_FACTORY_ADDRESS.toLowerCase()
        ) {
          throw new Error('V2 workflow vault factory was not deployed at its expected address');
        }
      })(),
      (async () => {
        const baseFactoryHash = await baseWallet.deployContract({
          abi: workflowVaultFactoryV2Artifact.abi,
          bytecode: workflowVaultFactoryV2Artifact.bytecode.object,
          args: [],
        });
        const baseFactoryReceipt = await basePublicClient.waitForTransactionReceipt({
          hash: baseFactoryHash,
        });
        if (
          baseFactoryReceipt.contractAddress?.toLowerCase() !==
          WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS.toLowerCase()
        ) {
          throw new Error(
            'Base V2 workflow vault factory was not deployed at its expected address',
          );
        }
      })(),
    ]);

    await Promise.all(
      (
        [
          [publicClient, wallet, UNICHAIN_SEPOLIA_CHAIN_ID],
          [basePublicClient, baseWallet, BASE_SEPOLIA_CHAIN_ID],
        ] as const
      ).map(async ([client, walletClient, chainId]) => {
        const usdc = getChain(chainId).usdc;
        const weth = getChain(chainId).weth;
        await Promise.all(
          [usdc, weth].map((token) =>
            client.request({
              method: 'anvil_setCode',
              params: [token, mockErc20Artifact.deployedBytecode.object],
            } as never),
          ),
        );
        for (const [token, amount] of [
          [usdc, 1_000_000_000_000n],
          [weth, 1_000_000n * 10n ** 18n],
        ] as const) {
          const hash = await walletClient.writeContract({
            address: token as Address,
            abi: ERC20,
            functionName: 'mint',
            args: [USER_ADDRESS, amount],
          });
          await client.waitForTransactionReceipt({ hash });
        }
      }),
    );

    const config: AppConfig = {
      PORT: FIXTURE_API_PORT,
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture',
      LASNA_RPC_URL: ANVIL_LASNA_RPC_URL,
      UNICHAIN_RPC_URL: ANVIL_RPC_URL,
      BASE_SEPOLIA_RPC_URL: ANVIL_BASE_RPC_URL,
      INDEXER_ENABLED: false,
      WORKFLOW_V2_DEPLOYMENT: {
        lasna: { factory: WORKFLOW_V2_AGENT_FACTORY_ADDRESS, startBlock: 1 },
        unichain: { factory: WORKFLOW_V2_VAULT_FACTORY_ADDRESS, startBlock: 1 },
        base: { factory: WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS, startBlock: 1 },
      },
      corsOrigins: [FIXTURE_FRONTEND_URL],
    };

    createChainClients(config);
    const built = buildServer(
      {
        config,
        databaseReachable: async () => true,
        rpcHealth: async () => [
          { chain_id: LASNA_CHAIN_ID, rpc_ok: true },
          { chain_id: UNICHAIN_SEPOLIA_CHAIN_ID, rpc_ok: true },
          { chain_id: BASE_SEPOLIA_CHAIN_ID, rpc_ok: true },
        ],
      },
      { logger: false },
    );
    const workflowDatabase = emptyWorkflowV2Database();
    registerWorkflowV2Routes(built.app, workflowDatabase, WORKFLOW_V2_AGENT_FACTORY_ADDRESS);
    serverRef.current = built.app;
    await built.app.listen({ port: FIXTURE_API_PORT, host: '127.0.0.1' });
    const v2Marketplace = await fetch(`${FIXTURE_API_URL}/v3/marketplace`, {
      headers: { origin: FIXTURE_FRONTEND_URL },
    });
    if (
      !v2Marketplace.ok ||
      v2Marketplace.headers.get('access-control-allow-origin') !== FIXTURE_FRONTEND_URL ||
      (await v2Marketplace.json()).listings.length !== 0
    )
      throw new Error('V2 fixture API or browser CORS check failed');

    process.stdout.write(`Fixture ready at ${FIXTURE_API_URL}\n`);
  } catch (error: unknown) {
    shutdown();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
