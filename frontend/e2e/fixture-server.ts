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
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  executionCreditAbi,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowDeploymentKey,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  type Address,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  clientFor,
  createChainClients,
  type ChainClients,
} from '../../backend/src/chain/clients.js';
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
  DEMO_ADDRESS,
  FIXTURE_API_PORT,
  FIXTURE_API_URL,
  FIXTURE_FRONTEND_URL,
  SPONSOR_ADDRESS,
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

interface FixtureDemoRecord {
  readonly activity: Record<string, unknown>;
  readonly health: Record<string, unknown>;
}

function fixtureWorkflowV2Database(clients: ChainClients, demo: FixtureDemoRecord) {
  const archives: Record<string, unknown>[] = [];
  const factories = {
    [UNICHAIN_SEPOLIA_CHAIN_ID]: WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
    [BASE_SEPOLIA_CHAIN_ID]: WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS,
  };
  const from = (table: string) => {
    const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
    const evaluate = () => {
      const rows =
        table === 'workflow_v2_activity'
          ? [demo.activity]
          : table === 'workflow_v2_archive_events'
            ? archives
            : [];
      return rows.filter((row) => predicates.every((predicate) => predicate(row)));
    };
    const builder = {
      select: () => builder,
      match: (criteria: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(criteria)) {
          predicates.push((row) => row[key] === value);
        }
        return builder;
      },
      eq: (key: string, value: unknown) => {
        predicates.push((row) => row[key] === value);
        return builder;
      },
      not: (key: string, operator: 'is', value: null) => {
        if (operator === 'is') predicates.push((row) => row[key] !== value);
        return builder;
      },
      in: (key: string, values: readonly unknown[]) => {
        predicates.push((row) => values.includes(row[key]));
        return builder;
      },
      or: () => builder,
      ilike: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: evaluate()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) =>
        Promise.resolve({ data: evaluate(), error: null }).then(resolve),
    };
    return builder;
  };
  return {
    from,
    rpc: async (
      fn: string,
      args: {
        p_deployment: string;
        p_owner: Address;
        p_chains: (keyof typeof factories)[];
        p_archived: boolean;
        p_cursor_chain: number;
        p_cursor_id: string | null;
        p_before: boolean;
        p_limit: number;
        p_chain: number;
        p_workflow: Hex;
        p_revision: number;
        p_epoch: string;
      },
    ) => {
      if (fn === 'workflow_v2_inventory_page') {
        const byChain = await Promise.all(
          args.p_chains.map(async (chain) => {
            const client = clientFor(clients, chain);
            const vault = await client.readContract({
              address: factories[chain],
              abi: workflowVaultFactoryV2Abi,
              functionName: 'vaultOf',
              args: [args.p_owner],
            });
            if (vault === zeroAddress) return [];
            const ids = await client.readContract({
              address: vault,
              abi: workflowVaultV2Abi,
              functionName: 'workflowIds',
            });
            return ids
              .filter((id) => {
                const archive = archives.find(
                  (row) =>
                    row.deployment === args.p_deployment &&
                    row.owner === args.p_owner &&
                    row.chain === chain &&
                    row.workflow_id === id,
                );
                return Boolean(archive?.archived) === args.p_archived;
              })
              .map((id) => ({ chain, id }));
          }),
        );
        const sorted = byChain.flat().sort((a, b) => a.chain - b.chain || a.id.localeCompare(b.id));
        const page = sorted.filter(({ chain, id }) => {
          if (!args.p_cursor_id) return true;
          const compared = chain - args.p_cursor_chain || id.localeCompare(args.p_cursor_id);
          return args.p_before ? compared < 0 : compared > 0;
        });
        if (args.p_before) page.reverse();
        return {
          data: { items: page.slice(0, args.p_limit), total: sorted.length, syncing: false },
          error: null,
        };
      }
      if (fn === 'workflow_v2_write_archive') {
        const key = {
          deployment: args.p_deployment,
          chain: args.p_chain,
          owner: args.p_owner,
          workflow_id: args.p_workflow,
        };
        const index = archives.findIndex((row) =>
          Object.entries(key).every(([field, value]) => row[field] === value),
        );
        if ((archives[index]?.revision ?? 0) !== args.p_revision)
          return { data: false, error: null };
        const updated = {
          ...key,
          archived: args.p_archived,
          revision: args.p_revision + 1,
          epoch: args.p_epoch,
        };
        if (index === -1) archives.push(updated);
        else archives[index] = updated;
        return { data: true, error: null };
      }
      if (
        fn === 'workflow_v2_health' &&
        demo &&
        args?.p_deployment === demo.activity.deployment &&
        args?.p_owner?.toLowerCase() === demo.activity.owner
      ) {
        return { data: [demo.health], error: null };
      }
      return { data: [], error: null };
    },
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
const workflowAgentReactV2Artifact = artifact(
  '../../contracts/out/WorkflowAgentReactV2.sol/WorkflowAgentReactV2.json',
);
const workflowAgentV2Artifact = artifact(
  '../../contracts/out/WorkflowAgentV2.sol/WorkflowAgentV2.json',
);
const workflowVaultFactoryV2Artifact = artifact(
  '../../contracts/out/WorkflowVaultFactoryV2.sol/WorkflowVaultFactoryV2.json',
);
const workflowVaultV2Artifact = artifact(
  '../../contracts/out/WorkflowVaultV2.sol/WorkflowVaultV2.json',
);
const workflowValidatorV2Artifact = artifact(
  '../../contracts/out/WorkflowProgramValidatorV2.sol/WorkflowProgramValidatorV2.json',
);
const mockErc20Artifact = artifact('../../contracts/out/MockERC20.sol/MockERC20.json');
const mockPairArtifact = artifact('../../contracts/out/MockPair.sol/MockPair.json');
const browserFeeProviderArtifact = artifact(
  '../../contracts/out/BrowserFeeProvider.sol/BrowserFeeProvider.json',
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

const MOCK_PAIR = parseAbi(['function setReserves(uint112 reserve0, uint112 reserve1)']);

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
          browserFeeProviderArtifact.deployedBytecode.object,
        ],
      } as never),
      publicClient.request({
        method: 'anvil_setCode',
        params: [
          getChain(UNICHAIN_SEPOLIA_CHAIN_ID).callbackProxy,
          browserFeeProviderArtifact.deployedBytecode.object,
        ],
      } as never),
      basePublicClient.request({
        method: 'anvil_setCode',
        params: [
          getChain(BASE_SEPOLIA_CHAIN_ID).callbackProxy,
          browserFeeProviderArtifact.deployedBytecode.object,
        ],
      } as never),
    ]);

    await Promise.all([
      (async () => {
        const systemContract = getChain(LASNA_CHAIN_ID).systemContract;
        const validatorHash = await lasnaWallet.deployContract({
          abi: workflowValidatorV2Artifact.abi,
          bytecode: workflowValidatorV2Artifact.bytecode.object,
          args: [],
        });
        const validatorReceipt = await lasnaPublicClient.waitForTransactionReceipt({
          hash: validatorHash,
        });
        const validatorAddress = validatorReceipt.contractAddress;
        if (!validatorAddress) throw new Error('Lasna validator deployment failed');

        const reactModuleHash = await lasnaWallet.deployContract({
          abi: workflowAgentReactV2Artifact.abi,
          bytecode: workflowAgentReactV2Artifact.bytecode.object,
          args: [systemContract, validatorAddress],
        });
        const reactModuleReceipt = await lasnaPublicClient.waitForTransactionReceipt({
          hash: reactModuleHash,
        });
        const reactModuleAddress = reactModuleReceipt.contractAddress;
        if (!reactModuleAddress) throw new Error('Lasna Agent react module deployment failed');

        const implHash = await lasnaWallet.deployContract({
          abi: workflowAgentV2Artifact.abi,
          bytecode: workflowAgentV2Artifact.bytecode.object,
          args: [systemContract, validatorAddress, reactModuleAddress],
        });
        const implReceipt = await lasnaPublicClient.waitForTransactionReceipt({ hash: implHash });
        const implAddress = implReceipt.contractAddress;
        if (!implAddress) throw new Error('Lasna Agent implementation deployment failed');

        const hash = await lasnaWallet.deployContract({
          abi: workflowAgentFactoryV2Artifact.abi,
          bytecode: workflowAgentFactoryV2Artifact.bytecode.object,
          args: [systemContract, validatorAddress, implAddress],
        });
        const receipt = await lasnaPublicClient.waitForTransactionReceipt({ hash });
        if (
          receipt.contractAddress?.toLowerCase() !== WORKFLOW_V2_AGENT_FACTORY_ADDRESS.toLowerCase()
        ) {
          throw new Error('V2 workflow agent factory was not deployed at its expected address');
        }
      })(),
      (async () => {
        const cfg = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
        const validatorHash = await wallet.deployContract({
          abi: workflowValidatorV2Artifact.abi,
          bytecode: workflowValidatorV2Artifact.bytecode.object,
          args: [],
        });
        const validatorReceipt = await publicClient.waitForTransactionReceipt({
          hash: validatorHash,
        });
        const validatorAddress = validatorReceipt.contractAddress;
        if (!validatorAddress) throw new Error('Unichain validator deployment failed');

        const market = {
          usdc: cfg.usdc,
          weth: cfg.weth,
          router: cfg.router,
          pair: cfg.pair,
          poolFee: cfg.poolFee ?? 0,
          ethUsdFeed: zeroAddress,
          usdcUsdFeed: zeroAddress,
          sequencerFeed: zeroAddress,
          ethFeedMaxAge: 0,
          usdcFeedMaxAge: 0,
        };
        const implHash = await wallet.deployContract({
          abi: workflowVaultV2Artifact.abi,
          bytecode: workflowVaultV2Artifact.bytecode.object,
          args: [
            cfg.callbackProxy,
            zeroAddress,
            zeroAddress,
            UNICHAIN_SEPOLIA_CHAIN_ID,
            market,
            validatorAddress,
          ],
        });
        const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash });
        const implAddress = implReceipt.contractAddress;
        if (!implAddress) throw new Error('Unichain Vault implementation deployment failed');

        const hash = await wallet.deployContract({
          abi: workflowVaultFactoryV2Artifact.abi,
          bytecode: workflowVaultFactoryV2Artifact.bytecode.object,
          args: [validatorAddress, implAddress],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (
          receipt.contractAddress?.toLowerCase() !== WORKFLOW_V2_VAULT_FACTORY_ADDRESS.toLowerCase()
        ) {
          throw new Error('V2 workflow vault factory was not deployed at its expected address');
        }
      })(),
      (async () => {
        const cfg = getChain(BASE_SEPOLIA_CHAIN_ID);
        const validatorHash = await baseWallet.deployContract({
          abi: workflowValidatorV2Artifact.abi,
          bytecode: workflowValidatorV2Artifact.bytecode.object,
          args: [],
        });
        const validatorReceipt = await basePublicClient.waitForTransactionReceipt({
          hash: validatorHash,
        });
        const validatorAddress = validatorReceipt.contractAddress;
        if (!validatorAddress) throw new Error('Base validator deployment failed');

        const market = {
          usdc: cfg.usdc,
          weth: cfg.weth,
          router: cfg.router,
          pair: cfg.pair,
          poolFee: cfg.poolFee ?? 0,
          ethUsdFeed: zeroAddress,
          usdcUsdFeed: zeroAddress,
          sequencerFeed: zeroAddress,
          ethFeedMaxAge: 0,
          usdcFeedMaxAge: 0,
        };
        const implHash = await baseWallet.deployContract({
          abi: workflowVaultV2Artifact.abi,
          bytecode: workflowVaultV2Artifact.bytecode.object,
          args: [
            cfg.callbackProxy,
            zeroAddress,
            zeroAddress,
            BASE_SEPOLIA_CHAIN_ID,
            market,
            validatorAddress,
          ],
        });
        const implReceipt = await basePublicClient.waitForTransactionReceipt({ hash: implHash });
        const implAddress = implReceipt.contractAddress;
        if (!implAddress) throw new Error('Base Vault implementation deployment failed');

        const baseFactoryHash = await baseWallet.deployContract({
          abi: workflowVaultFactoryV2Artifact.abi,
          bytecode: workflowVaultFactoryV2Artifact.bytecode.object,
          args: [validatorAddress, implAddress],
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

        const pair = getChain(chainId).pair;
        const usdcIsToken0 = usdc.toLowerCase() < weth.toLowerCase();
        const [token0, token1] = usdcIsToken0 ? [usdc, weth] : [weth, usdc];
        const deployPairHash = await walletClient.deployContract({
          abi: mockPairArtifact.abi,
          bytecode: mockPairArtifact.bytecode.object,
          args: [token0, token1],
        });
        const deployPairReceipt = await client.waitForTransactionReceipt({ hash: deployPairHash });
        if (!deployPairReceipt.contractAddress) {
          throw new Error(`MockPair deployment failed on chain ${chainId}`);
        }
        const pairCode = await client.getCode({ address: deployPairReceipt.contractAddress });
        if (!pairCode) {
          throw new Error(`MockPair runtime bytecode missing on chain ${chainId}`);
        }
        await client.request({
          method: 'anvil_setCode',
          params: [pair, pairCode],
        } as never);
        const usdcReserve =
          chainId === UNICHAIN_SEPOLIA_CHAIN_ID ? 250_000_000_000n : 260_000_000_000n;
        const wethReserve = 100n * 10n ** 18n;
        const [reserve0, reserve1] = usdcIsToken0
          ? [usdcReserve, wethReserve]
          : [wethReserve, usdcReserve];
        const reservesHash = await walletClient.writeContract({
          address: pair,
          abi: MOCK_PAIR,
          functionName: 'setReserves',
          args: [reserve0, reserve1],
        });
        await client.waitForTransactionReceipt({ hash: reservesHash });
      }),
    );

    const demoWallet = createWalletClient({
      account: DEMO_ADDRESS,
      chain: anvilChain,
      transport: http(ANVIL_RPC_URL),
    });
    const demoLasnaWallet = createWalletClient({
      account: DEMO_ADDRESS,
      chain: lasnaAnvilChain,
      transport: http(ANVIL_LASNA_RPC_URL),
    });

    const createAgentHash = await demoLasnaWallet.writeContract({
      address: WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
      abi: workflowAgentFactoryV2Abi,
      functionName: 'create',
    });
    await lasnaPublicClient.waitForTransactionReceipt({ hash: createAgentHash });
    const demoAgent = await lasnaPublicClient.readContract({
      address: WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
      abi: workflowAgentFactoryV2Abi,
      functionName: 'agentOf',
      args: [DEMO_ADDRESS],
    });
    if (demoAgent === zeroAddress) throw new Error('Demo Agent deployment failed');

    const createVaultHash = await demoWallet.writeContract({
      address: WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
      abi: workflowVaultFactoryV2Abi,
      functionName: 'create',
      args: [demoAgent],
    });
    await publicClient.waitForTransactionReceipt({ hash: createVaultHash });
    const demoVault = await publicClient.readContract({
      address: WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
      abi: workflowVaultFactoryV2Abi,
      functionName: 'vaultOf',
      args: [DEMO_ADDRESS],
    });
    if (demoVault === zeroAddress) throw new Error('Demo Vault deployment failed');

    const linkHash = await demoLasnaWallet.writeContract({
      address: demoAgent,
      abi: workflowAgentV2Abi,
      functionName: 'linkVault',
      args: [UNICHAIN_SEPOLIA_CHAIN_ID, demoVault],
    });
    await lasnaPublicClient.waitForTransactionReceipt({ hash: linkHash });

    const unichainUsdc = getChain(UNICHAIN_SEPOLIA_CHAIN_ID).usdc;
    const mintDemoUsdcHash = await wallet.writeContract({
      address: unichainUsdc,
      abi: ERC20,
      functionName: 'mint',
      args: [DEMO_ADDRESS, 25_000_000n],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintDemoUsdcHash });

    const fundDemoVaultHash = await demoWallet.writeContract({
      address: unichainUsdc,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [demoVault, 25_000_000n],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundDemoVaultHash });

    const execCreditHash = await demoWallet.writeContract({
      address: getChain(UNICHAIN_SEPOLIA_CHAIN_ID).callbackProxy,
      abi: executionCreditAbi,
      functionName: 'depositTo',
      args: [demoVault],
      value: 100_000_000_000_000_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: execCreditHash });

    const watchCreditHash = await demoLasnaWallet.writeContract({
      address: getChain(LASNA_CHAIN_ID).systemContract,
      abi: executionCreditAbi,
      functionName: 'depositTo',
      args: [demoAgent],
      value: 500_000_000_000_000_000n,
    });
    await lasnaPublicClient.waitForTransactionReceipt({ hash: watchCreditHash });

    const demoWorkflowId = `0x${'de'.repeat(32)}` as Hex;
    const demoTitle = 'Income sweep demo';
    const demoProgram = encodeWorkflowV2(
      createWorkflowV2Recipe(
        'income-sweep',
        { minimumPaymentUsdc: '1', sendUsdc: '0.2', recipient: SPONSOR_ADDRESS },
        { chain: UNICHAIN_SEPOLIA_CHAIN_ID, vault: demoVault },
      ),
    );
    const demoProgramHash = keccak256(demoProgram);
    const authorizeHash = await demoWallet.writeContract({
      address: demoVault,
      abi: workflowVaultV2Abi,
      functionName: 'authorizeWithWeeklyBudget',
      args: [demoWorkflowId, 1n, demoProgram, demoTitle, 10_000_000n, 0n],
    });
    await publicClient.waitForTransactionReceipt({ hash: authorizeHash });

    const [demoAuth, demoBudget] = await Promise.all([
      publicClient.readContract({
        address: demoVault,
        abi: workflowVaultV2Abi,
        functionName: 'authorizations',
        args: [demoWorkflowId],
      }),
      publicClient.readContract({
        address: demoVault,
        abi: workflowVaultV2Abi,
        functionName: 'weeklyBudget',
        args: [demoWorkflowId],
      }),
    ]);
    const enableHash = await demoLasnaWallet.writeContract({
      address: demoAgent,
      abi: workflowAgentV2Abi,
      functionName: 'enableWithBudget',
      args: [
        demoWorkflowId,
        1n,
        demoProgram,
        demoTitle,
        demoAuth[2],
        {
          usdcLimit: demoBudget[0],
          wethLimit: demoBudget[1],
          usdcSpent: demoBudget[2],
          wethSpent: demoBudget[3],
          weekStart: demoBudget[6] >= 604_800n ? demoBudget[6] - 604_800n : 0n,
          revision: demoBudget[7],
        },
      ],
    });
    await lasnaPublicClient.waitForTransactionReceipt({ hash: enableHash });

    const demoRunId = `0x${'ef'.repeat(32)}` as Hex;
    const demoDeployment = workflowDeploymentKey(LASNA_CHAIN_ID, WORKFLOW_V2_AGENT_FACTORY_ADDRESS);
    const demoExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    const demoRecord: FixtureDemoRecord = {
      activity: {
        deployment: demoDeployment,
        owner: DEMO_ADDRESS.toLowerCase(),
        id: demoRunId,
        workflow_id: demoWorkflowId,
        agent: demoAgent.toLowerCase(),
        title: demoTitle,
        chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        program_hash: demoProgramHash,
        epoch: '1',
        origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        origin_transaction: authorizeHash.toLowerCase(),
        origin_log_index: '1',
        lasna_transaction: enableHash.toLowerCase(),
        lasna_block: 100,
        expires_at: demoExpiresAt,
        destination_transaction: fundDemoVaultHash.toLowerCase(),
        reason: null,
        path: 0,
        status: 'confirmed',
      },
      health: {
        chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        workflow_id: demoWorkflowId,
        last_run_id: demoRunId,
        last_status: 'confirmed',
        last_reason: null,
        last_expires_at: demoExpiresAt,
        last_path: 0,
        last_lasna_transaction: enableHash.toLowerCase(),
        last_destination_transaction: fundDemoVaultHash.toLowerCase(),
        last_success_id: demoRunId,
        last_success_path: 0,
        last_success_lasna_transaction: enableHash.toLowerCase(),
        last_success_destination_transaction: fundDemoVaultHash.toLowerCase(),
        pending_run_id: null,
        pending_expires_at: null,
      },
    };

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
      demoAccount: DEMO_ADDRESS,
      corsOrigins: [FIXTURE_FRONTEND_URL],
    };

    const clients = createChainClients(config);
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
    const workflowDatabase = fixtureWorkflowV2Database(clients, demoRecord);
    registerWorkflowV2Routes(
      built.app,
      workflowDatabase,
      WORKFLOW_V2_AGENT_FACTORY_ADDRESS,
      undefined,
      { owner: DEMO_ADDRESS },
      {
        clients,
        corsOrigins: config.corsOrigins,
        vaultFactories: {
          [UNICHAIN_SEPOLIA_CHAIN_ID]: WORKFLOW_V2_VAULT_FACTORY_ADDRESS,
          [BASE_SEPOLIA_CHAIN_ID]: WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS,
        },
      },
    );
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
