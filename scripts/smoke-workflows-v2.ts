/**
 * Live Workflow V2 smoke evidence.
 *
 * Creates (or reuses) the deploying wallet's Agent and Vaults on the factories recorded in
 * `deployments/workflows-v2.json` (or `deployments/workflows-v2-mainnet.json` with `--mainnet`),
 * retires any stale payment or smoke workflows on both Vault and Agent, activates the shipped
 * income-sweep recipe and a scheduled buy on each target chain, verifies settlement receipts,
 * revokes and disables both smoke workflows in a `finally` block (including on failure/abort),
 * and writes every origin, decision, settlement, and cleanup receipt to
 * `deployments/workflows-v2-smoke.json` (or `deployments/workflows-v2-mainnet-smoke.json`).
 *
 * Options:
 *   --mainnet                      Run against Reactive Mainnet (1597) and mainnet funds chains.
 *   --confirm-mainnet              Required with `--mainnet` (or `CONFIRM_MAINNET_SMOKE=I_UNDERSTAND_REAL_FUNDS`).
 *   --chain / --chains <targets>   Comma-separated targets: `unichain`, `base`, `all`, or chain IDs.
 *                                  Defaults to all configured funds chains for the mode
 *                                  (mainnet: 130, 8453; testnet: 1301, 84532).
 *
 * Env:
 *   Testnet: LASNA_RPC_URL, UNICHAIN_RPC_URL, BASE_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY.
 *   Mainnet: REACTIVE_MAINNET_RPC_URL, UNICHAIN_MAINNET_RPC_URL, BASE_MAINNET_RPC_URL,
 *            MAINNET_DEPLOYER_PRIVATE_KEY.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  createWorkflowV2Recipe,
  encodeWorkflowV2,
  executionCreditAbi,
  fundsChainsFor,
  getChain,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  workflowVaultFactoryV2Abi,
  workflowVaultV2Abi,
  type AutomationChainId,
  type FundsChainId,
  type SupportedChainId,
  type WorkflowV2Program,
} from '@rulebook/shared';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  getAbiItem,
  http,
  isAddress,
  keccak256,
  parseEther,
  parseUnits,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const LOG_BLOCK_CHUNK_SIZE = 200n;
export const LOG_REORG_OVERLAP = 2n;
export const AGENT_MAX_ACTIVE = 4;
export const SMOKE_REQUIRED_ACTIVE_SLOTS = 2;
export const SMOKE_WORKFLOW_TITLES = ['Income sweep smoke', 'Scheduled buy smoke'] as const;

const SMOKE_TRANSFER_AMOUNTS = ['1.20', '0.60', '0.10'] as const;
const SMOKE_SCHEDULE_BUY_USDC = '0.2';
// 1.20 + 0.60 + 0.10 - (0.20 + 0.05 swept back to recipient === owner.address) = 1.65 USDC.
const SMOKE_MIN_TOTAL_USDC = parseUnits('1.65', 6);

export interface VaultAuthorizationState {
  epoch: bigint;
  active: boolean;
}

export interface AgentEntryState {
  epoch: bigint;
  trigger: number;
  chain: number;
}

export interface RetireWorkflowDeps {
  readVaultAuthorization: (workflowId: Hex) => Promise<VaultAuthorizationState>;
  readAgentEntry: (workflowId: Hex) => Promise<AgentEntryState>;
  revokeOnVault: (workflowId: Hex, epoch: bigint) => Promise<Hex>;
  disableOnAgent: (workflowId: Hex, epoch: bigint) => Promise<Hex>;
}

export interface RetireWorkflowResult {
  workflowId: Hex;
  vaultRevokeTransaction: Hex | null;
  agentDisableTransaction: Hex | null;
}

export interface ActiveAgentWorkflow {
  workflowId: Hex;
  chain: number;
  epoch: bigint;
  trigger: number;
  title: string;
}

export interface RetireStaleWorkflowsOptions {
  fundsChainId: FundsChainId;
  readPaymentWorkflow: () => Promise<Hex>;
  readAgentWorkflowIds: () => Promise<readonly Hex[]>;
  readAgentEntry: (workflowId: Hex) => Promise<AgentEntryState>;
  readAgentTitle: (workflowId: Hex) => Promise<string>;
  readVaultWorkflowIds?: () => Promise<readonly Hex[]>;
  readVaultAuthorization?: (workflowId: Hex) => Promise<VaultAuthorizationState>;
  readVaultTitle?: (workflowId: Hex) => Promise<string>;
  retire: (workflowId: Hex) => Promise<RetireWorkflowResult>;
  requiredSlots?: number;
  maxActive?: number;
}

export interface RetireStaleWorkflowsResult {
  retired: RetireWorkflowResult[];
  remainingActiveAgentWorkflows: ActiveAgentWorkflow[];
}

export interface SmokeCleanupReceipt {
  vaultRevokeTransaction: Hex | null;
  agentDisableTransaction: Hex | null;
}

export interface SmokeRunEvidence {
  spentUsdcBaseUnits: string;
  runId: Hex;
  path: number;
  status: string;
  originTransaction: Hex;
  lasnaTransaction: Hex;
  destinationTransaction: Hex;
}

export interface ChainSmokeEvidence {
  chainId: FundsChainId;
  chainName: string;
  vaultFactory: Address;
  deploymentCommit?: string;
  vault: Address;
  retiredStaleWorkflows: RetireWorkflowResult[];
  sweep: {
    title: string;
    workflow: Hex;
    programHash: Hex;
    authorizationTransaction: Hex;
    weeklyUsdcLimitBaseUnits: string;
    runs: Array<SmokeRunEvidence & { inputUsdcBaseUnits: string }>;
    cleanup: SmokeCleanupReceipt;
  };
  schedule: {
    title: string;
    workflow: Hex;
    programHash: Hex;
    authorizationTransaction: Hex;
    run: SmokeRunEvidence;
    cleanup: SmokeCleanupReceipt;
  };
}

export interface SmokeEvidence {
  network: 'mainnet' | 'testnet';
  automationChainId: AutomationChainId;
  agentFactory: Address;
  deploymentCommit?: string;
  agent: Address;
  recipient: Address;
  chains: Record<string, ChainSmokeEvidence>;
}

function env(name: string, fallback?: string, envMap: NodeJS.ProcessEnv = process.env) {
  const value = envMap[name]?.trim() || fallback;
  if (!value) throw new Error('Set ' + name + ' before running the live smoke.');
  return value;
}

function normalizePrivateKey(raw: string): Hex {
  return (raw.startsWith('0x') ? raw : '0x' + raw) as Hex;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function fundsRpcEnvName(chainId: FundsChainId): string {
  switch (chainId) {
    case UNICHAIN_SEPOLIA_CHAIN_ID:
      return 'UNICHAIN_RPC_URL';
    case BASE_SEPOLIA_CHAIN_ID:
      return 'BASE_SEPOLIA_RPC_URL';
    case UNICHAIN_MAINNET_CHAIN_ID:
      return 'UNICHAIN_MAINNET_RPC_URL';
    case BASE_MAINNET_CHAIN_ID:
      return 'BASE_MAINNET_RPC_URL';
  }
}

export function smokeSlippagePercent(chainId: FundsChainId): string {
  return chainId === UNICHAIN_MAINNET_CHAIN_ID || chainId === BASE_MAINNET_CHAIN_ID ? '1.0' : '0.5';
}

export function assertSmokeCliArgs(argv: readonly string[] = process.argv.slice(2)): void {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--mainnet' || arg === '--confirm-mainnet') {
      continue;
    }
    if (arg === '--chain' || arg === '--chains') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}. Expected unichain, base, all, or a chain ID.`);
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--chain=') || arg.startsWith('--chains=')) {
      continue;
    }
    throw new Error(
      `Unknown argument "${arg}". Supported options: --mainnet, --confirm-mainnet, --chain <targets>, --chains <targets>.`,
    );
  }
}

export function resolveSmokeTargetChains(
  isMainnet: boolean,
  argv: readonly string[] = process.argv.slice(2),
): FundsChainId[] {
  const allowed = fundsChainsFor(isMainnet ? 'mainnet' : 'testnet');
  const rawTargets: string[] = [];
  const missingMsg = `Missing value for --chain. Expected unichain, base, all, or a chain ID (${allowed.join(', ')}).`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--chain' || arg === '--chains') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(missingMsg);
      }
      rawTargets.push(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--chain=') || arg.startsWith('--chains=')) {
      const eqIndex = arg.indexOf('=');
      const value = arg.slice(eqIndex + 1).trim();
      if (!value) {
        throw new Error(missingMsg);
      }
      rawTargets.push(value);
    }
  }

  if (rawTargets.length === 0) {
    return [...allowed];
  }

  const selected: FundsChainId[] = [];
  const seenChains = new Set<FundsChainId>();
  const addChain = (chainId: FundsChainId) => {
    if (!seenChains.has(chainId)) {
      seenChains.add(chainId);
      selected.push(chainId);
    }
  };

  for (const rawTarget of rawTargets) {
    const parts = rawTarget.split(',');
    for (const rawPart of parts) {
      const token = rawPart.trim().toLowerCase();
      if (!token) {
        throw new Error(missingMsg);
      }
      if (token === 'all') {
        for (const id of allowed) addChain(id);
        continue;
      }
      if (token === 'unichain') {
        addChain(isMainnet ? UNICHAIN_MAINNET_CHAIN_ID : UNICHAIN_SEPOLIA_CHAIN_ID);
        continue;
      }
      if (token === 'base') {
        addChain(isMainnet ? BASE_MAINNET_CHAIN_ID : BASE_SEPOLIA_CHAIN_ID);
        continue;
      }
      if (/^\d+$/.test(token)) {
        const numeric = Number(token);
        if ((allowed as readonly number[]).includes(numeric)) {
          addChain(numeric as FundsChainId);
          continue;
        }
        throw new Error(
          `Chain ${numeric} is not a ${isMainnet ? 'mainnet' : 'testnet'} funds chain. Allowed: ${allowed.join(', ')}.`,
        );
      }
      throw new Error(
        `Invalid --chain target "${rawPart.trim()}". Expected unichain, base, all, or a chain ID (${allowed.join(', ')}).`,
      );
    }
  }

  return selected;
}

export function resolveSmokeSignerKey(
  isMainnet: boolean,
  envMap: NodeJS.ProcessEnv = process.env,
): Hex {
  if (!isMainnet) {
    const raw = env('DEPLOYER_PRIVATE_KEY', undefined, envMap);
    const key = normalizePrivateKey(raw);
    privateKeyToAccount(key);
    return key;
  }
  const raw = envMap.MAINNET_DEPLOYER_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error(
      'Set a dedicated MAINNET_DEPLOYER_PRIVATE_KEY before running the mainnet live smoke (never reuse DEPLOYER_PRIVATE_KEY).',
    );
  }
  const key = normalizePrivateKey(raw);
  const mainnetAccount = privateKeyToAccount(key);
  for (const testnetKeyName of ['DEPLOYER_PRIVATE_KEY', 'SPONSOR_PRIVATE_KEY'] as const) {
    const testnetRaw = envMap[testnetKeyName]?.trim();
    if (!testnetRaw || !/^(?:0x)?[0-9a-f]{64}$/i.test(testnetRaw)) continue;
    const testnetAccount = privateKeyToAccount(normalizePrivateKey(testnetRaw));
    if (testnetAccount.address.toLowerCase() === mainnetAccount.address.toLowerCase()) {
      throw new Error(
        `MAINNET_DEPLOYER_PRIVATE_KEY must not share an address with ${testnetKeyName} (${mainnetAccount.address}).`,
      );
    }
  }
  return key;
}

export async function getLogsChunked<TLog>(
  getBlockNumber: () => Promise<bigint>,
  fetchChunk: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<readonly TLog[]>,
  fromBlock: bigint,
  chunkSize: bigint = LOG_BLOCK_CHUNK_SIZE,
): Promise<{ logs: TLog[]; lastScannedBlock: bigint | null }> {
  if (chunkSize < 1n) {
    throw new Error('Log block chunk size must be at least 1.');
  }
  const head = await getBlockNumber();
  if (fromBlock > head) {
    return { logs: [], lastScannedBlock: null };
  }
  const logs: TLog[] = [];
  for (let cursor = fromBlock; cursor <= head; cursor += chunkSize) {
    const toBlock = cursor + chunkSize - 1n < head ? cursor + chunkSize - 1n : head;
    const chunk = await fetchChunk({ fromBlock: cursor, toBlock });
    logs.push(...chunk);
  }
  return { logs, lastScannedBlock: head };
}

export function nextLogScanCursor(
  startBlock: bigint,
  currentCursor: bigint,
  lastScannedBlock: bigint | null,
  overlap: bigint = LOG_REORG_OVERLAP,
): bigint {
  if (lastScannedBlock === null) return currentCursor;
  const candidate = lastScannedBlock >= overlap ? lastScannedBlock - overlap : 0n;
  return candidate > startBlock ? candidate : startBlock;
}

export async function retireWorkflow(
  workflowId: Hex,
  deps: RetireWorkflowDeps,
): Promise<RetireWorkflowResult> {
  const [vaultRead, agentRead] = await Promise.allSettled([
    deps.readVaultAuthorization(workflowId),
    deps.readAgentEntry(workflowId),
  ]);

  let vaultRevokeTransaction: Hex | null = null;
  let agentDisableTransaction: Hex | null = null;
  const errors: string[] = [];

  if (vaultRead.status === 'fulfilled') {
    if (vaultRead.value.active) {
      try {
        vaultRevokeTransaction = await deps.revokeOnVault(workflowId, vaultRead.value.epoch);
      } catch (error) {
        errors.push(`vault revoke failed: ${errorMessage(error)}`);
      }
    }
  } else {
    errors.push(`vault authorization read failed: ${errorMessage(vaultRead.reason)}`);
  }

  if (agentRead.status === 'fulfilled') {
    if (agentRead.value.trigger !== 0) {
      try {
        agentDisableTransaction = await deps.disableOnAgent(workflowId, agentRead.value.epoch);
      } catch (error) {
        errors.push(`agent disable failed: ${errorMessage(error)}`);
      }
    }
  } else {
    errors.push(`agent entry read failed: ${errorMessage(agentRead.reason)}`);
  }

  if (errors.length > 0) {
    const completed: string[] = [];
    if (vaultRevokeTransaction) completed.push(`vaultRevoke=${vaultRevokeTransaction}`);
    if (agentDisableTransaction) completed.push(`agentDisable=${agentDisableTransaction}`);
    const completedNote = completed.length > 0 ? ` (completed: ${completed.join(', ')})` : '';
    throw new Error(
      `Failed to retire workflow ${workflowId}${completedNote}: ${errors.join('; ')}`,
    );
  }

  return {
    workflowId,
    vaultRevokeTransaction,
    agentDisableTransaction,
  };
}

export async function retireStaleWorkflowsForChain(
  options: RetireStaleWorkflowsOptions,
): Promise<RetireStaleWorkflowsResult> {
  const requiredSlots = options.requiredSlots ?? SMOKE_REQUIRED_ACTIVE_SLOTS;
  const maxActive = options.maxActive ?? AGENT_MAX_ACTIVE;

  const [activePayment, knownAgentIds, knownVaultIds] = await Promise.all([
    options.readPaymentWorkflow(),
    options.readAgentWorkflowIds(),
    options.readVaultWorkflowIds
      ? options.readVaultWorkflowIds()
      : Promise.resolve([] as readonly Hex[]),
  ]);

  const dedupeIds = (ids: readonly Hex[]) => {
    const unique: Hex[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const key = id.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(id);
      }
    }
    return unique;
  };

  const uniqueAgentIds = dedupeIds(knownAgentIds);
  const uniqueVaultIds = dedupeIds(knownVaultIds);

  const [entryStates, vaultAuthStates] = await Promise.all([
    Promise.all(
      uniqueAgentIds.map(async (workflowId) => ({
        workflowId,
        entry: await options.readAgentEntry(workflowId),
      })),
    ),
    options.readVaultAuthorization
      ? Promise.all(
          uniqueVaultIds.map(async (workflowId) => ({
            workflowId,
            auth: await options.readVaultAuthorization!(workflowId),
          })),
        )
      : Promise.resolve([] as Array<{ workflowId: Hex; auth: VaultAuthorizationState }>),
  ]);

  const [activeEntries, activeVaultSmokeIds] = await Promise.all([
    Promise.all(
      entryStates
        .filter(({ entry }) => entry.trigger !== 0)
        .map(async ({ workflowId, entry }) => ({
          workflowId,
          chain: entry.chain,
          epoch: entry.epoch,
          trigger: entry.trigger,
          title: await options.readAgentTitle(workflowId),
        })),
    ),
    options.readVaultTitle
      ? Promise.all(
          vaultAuthStates
            .filter(({ auth }) => auth.active)
            .map(async ({ workflowId }) => ({
              workflowId,
              title: await options.readVaultTitle!(workflowId),
            })),
        ).then((items) =>
          items
            .filter((item) => (SMOKE_WORKFLOW_TITLES as readonly string[]).includes(item.title))
            .map((item) => item.workflowId),
        )
      : Promise.resolve([] as Hex[]),
  ]);

  const staleIds: Hex[] = [];
  const staleKeySet = new Set<string>();
  const addStale = (workflowId: Hex) => {
    const key = workflowId.toLowerCase();
    if (!staleKeySet.has(key)) {
      staleKeySet.add(key);
      staleIds.push(workflowId);
    }
  };

  if (activePayment !== zeroHash) {
    addStale(activePayment);
  }
  for (const item of activeEntries) {
    if (
      item.chain === options.fundsChainId &&
      (SMOKE_WORKFLOW_TITLES as readonly string[]).includes(item.title)
    ) {
      addStale(item.workflowId);
    }
  }
  for (const workflowId of activeVaultSmokeIds) {
    addStale(workflowId);
  }

  const retired: RetireWorkflowResult[] = [];
  const errors: string[] = [];
  for (const workflowId of staleIds) {
    try {
      retired.push(await options.retire(workflowId));
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Failed to retire stale workflows for chain ${options.fundsChainId}:\n${errors.join('\n')}`,
    );
  }

  const remainingActiveAgentWorkflows = activeEntries.filter(
    (item) => !staleKeySet.has(item.workflowId.toLowerCase()),
  );

  if (remainingActiveAgentWorkflows.length + requiredSlots > maxActive) {
    const activeSummary = remainingActiveAgentWorkflows
      .map((item) => `${item.workflowId} (chain ${item.chain}, "${item.title}")`)
      .join(', ');
    throw new Error(
      `Agent only supports MAX_ACTIVE = ${maxActive} active workflows and needs ${requiredSlots} free slots for smoke on chain ${options.fundsChainId}, but ${remainingActiveAgentWorkflows.length} non-smoke active workflow(s) remain: ${activeSummary}.`,
    );
  }

  return {
    retired,
    remainingActiveAgentWorkflows,
  };
}

export async function runWithWorkflowCleanup<T>(
  run: (trackWorkflow: (id: Hex) => void) => Promise<T>,
  retire: (id: Hex) => Promise<RetireWorkflowResult>,
  onCleanupError?: (message: string) => void,
): Promise<{ result: T; cleanups: RetireWorkflowResult[] }> {
  const tracked: Hex[] = [];
  const trackedKeys = new Set<string>();
  const trackWorkflow = (id: Hex) => {
    const key = id.toLowerCase();
    if (!trackedKeys.has(key)) {
      trackedKeys.add(key);
      tracked.push(id);
    }
  };

  let result!: T;
  let hasRunError = false;
  let runError: unknown;
  const cleanups: RetireWorkflowResult[] = [];
  const cleanupErrors: string[] = [];

  try {
    result = await run(trackWorkflow);
  } catch (error) {
    hasRunError = true;
    runError = error;
  } finally {
    for (const id of [...tracked].reverse()) {
      try {
        cleanups.push(await retire(id));
      } catch (error) {
        const msg = errorMessage(error);
        cleanupErrors.push(`${id}: ${msg}`);
      }
    }
    if (cleanupErrors.length > 0) {
      onCleanupError?.(
        `CRITICAL: Failed to clean up smoke workflow(s):\n${cleanupErrors.join('\n')}`,
      );
    }
  }

  if (hasRunError && cleanupErrors.length > 0) {
    throw new Error(
      `${errorMessage(runError)}\nCleanup also failed for active smoke workflows:\n${cleanupErrors.join('\n')}`,
      { cause: runError },
    );
  }
  if (hasRunError) {
    throw runError;
  }
  if (cleanupErrors.length > 0) {
    throw new Error(
      `Smoke verification succeeded, but workflow cleanup failed:\n${cleanupErrors.join('\n')}`,
    );
  }

  return { result, cleanups };
}

export function mergeSmokeEvidence(existingRaw: unknown, next: SmokeEvidence): SmokeEvidence {
  if (!isPlainObject(existingRaw)) return next;
  if (existingRaw.network !== next.network) return next;
  if (existingRaw.automationChainId !== next.automationChainId) return next;
  if (
    typeof existingRaw.agentFactory !== 'string' ||
    existingRaw.agentFactory.toLowerCase() !== next.agentFactory.toLowerCase()
  ) {
    return next;
  }
  if (
    typeof existingRaw.agent !== 'string' ||
    existingRaw.agent.toLowerCase() !== next.agent.toLowerCase()
  ) {
    return next;
  }
  if (!isPlainObject(existingRaw.chains)) return next;

  return {
    ...next,
    chains: {
      ...(existingRaw.chains as Record<string, ChainSmokeEvidence>),
      ...next.chains,
    },
  };
}

const statuses: Record<number, string> = {
  0: 'none',
  1: 'confirmed',
  2: 'skipped',
  3: 'expired',
  4: 'failed',
  5: 'unconfirmed',
  6: 'in grace period',
};
const dispatched = getAbiItem({ abi: workflowAgentV2Abi, name: 'Dispatched' });
const outcome = getAbiItem({ abi: workflowVaultV2Abi, name: 'Outcome' });
const step = getAbiItem({ abi: workflowVaultV2Abi, name: 'Step' });

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('Smoke aborted by signal.'));
  }
  return new Promise((resolveDelay, rejectDelay) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolveDelay();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      rejectDelay(new Error('Smoke aborted by signal.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function main() {
  assertSmokeCliArgs();
  const IS_MAINNET = process.argv.includes('--mainnet');
  const MAINNET_CONFIRMED =
    process.argv.includes('--confirm-mainnet') ||
    process.env.CONFIRM_MAINNET_SMOKE === 'I_UNDERSTAND_REAL_FUNDS';
  if (IS_MAINNET && !MAINNET_CONFIRMED) {
    process.stderr.write(
      [
        'Refusing to run mainnet smoke test without explicit confirmation.',
        'This script spends real REACT, ETH, and USDC on live mainnet networks.',
        'Re-run with --confirm-mainnet or CONFIRM_MAINNET_SMOKE=I_UNDERSTAND_REAL_FUNDS.',
      ].join('\n') + '\n',
    );
    process.exitCode = 1;
    return;
  }

  const targetChains = resolveSmokeTargetChains(IS_MAINNET);
  const AUTOMATION_CHAIN_ID: AutomationChainId = IS_MAINNET
    ? REACTIVE_MAINNET_CHAIN_ID
    : LASNA_CHAIN_ID;
  const RECORD_FILE = IS_MAINNET
    ? '../deployments/workflows-v2-mainnet.json'
    : '../deployments/workflows-v2.json';
  const SMOKE_FILE = IS_MAINNET
    ? '../deployments/workflows-v2-mainnet-smoke.json'
    : '../deployments/workflows-v2-smoke.json';

  function connection<T extends SupportedChainId>(id: T, rpc: string, symbol: string) {
    const config = getChain(id);
    const chain = defineChain({
      id,
      name: config.name,
      testnet: !IS_MAINNET,
      nativeCurrency: { name: symbol, symbol, decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    });
    const transport = http(rpc, { timeout: 20_000 });
    return { chain, transport, public: createPublicClient({ chain, transport }), config };
  }

  const automation = connection(
    AUTOMATION_CHAIN_ID,
    env(
      IS_MAINNET ? 'REACTIVE_MAINNET_RPC_URL' : 'LASNA_RPC_URL',
      getChain(AUTOMATION_CHAIN_ID).rpcUrl,
    ),
    IS_MAINNET ? 'REACT' : 'lREACT',
  );

  const fundsConnections = new Map<FundsChainId, ReturnType<typeof connection<FundsChainId>>>();
  for (const chainId of targetChains) {
    fundsConnections.set(
      chainId,
      connection(chainId, env(fundsRpcEnvName(chainId), getChain(chainId).rpcUrl), 'ETH'),
    );
  }

  const owner = privateKeyToAccount(resolveSmokeSignerKey(IS_MAINNET));
  const recipient = owner.address;

  const records: { contract: string; chainId: number; address: Address; commit?: string }[] =
    JSON.parse(await readFile(new URL(RECORD_FILE, import.meta.url), 'utf8'));
  function factoryRecord(contract: string, chainId: number) {
    const entry = records.find((item) => item.contract === contract && item.chainId === chainId);
    if (!entry || !isAddress(entry.address)) {
      throw new Error(`Missing deployment record ${contract} for chain ${chainId}.`);
    }
    return entry;
  }

  const agentFactoryEntry = factoryRecord('WorkflowAgentFactoryV2', AUTOMATION_CHAIN_ID);
  const agentFactory = agentFactoryEntry.address;
  const vaultFactoryEntries = new Map<FundsChainId, { address: Address; commit?: string }>();
  for (const chainId of targetChains) {
    const entry = factoryRecord('WorkflowVaultFactoryV2', chainId);
    vaultFactoryEntries.set(chainId, { address: entry.address, commit: entry.commit });
  }

  type AnyNetwork = typeof automation | ReturnType<typeof connection<FundsChainId>>;

  async function send(
    network: AnyNetwork,
    to: Address,
    data?: Hex,
    value = 0n,
  ): Promise<{ transactionHash: Hex; blockNumber: bigint }> {
    const wallet = createWalletClient({
      chain: network.chain,
      transport: network.transport,
      account: owner,
    });
    // Reactive chains accept legacy-priced transactions; the node rejects EIP-1559 fees.
    const fees =
      network.chain.id === AUTOMATION_CHAIN_ID
        ? { gasPrice: (await network.public.getGasPrice()) * 2n + 1n }
        : {};
    const hash = await wallet.sendTransaction({ to, data, value, ...fees });
    const receipt = await network.public.waitForTransactionReceipt({
      hash,
      confirmations: 2,
      timeout: 120_000,
    });
    if (receipt.status !== 'success') throw new Error('Transaction reverted ' + hash);
    return { transactionHash: hash, blockNumber: receipt.blockNumber };
  }

  const autoTargetReserve = IS_MAINNET ? parseEther('1') : parseEther('0.4');
  const settlementTargetReserve = IS_MAINNET ? parseEther('0.002') : parseEther('0.00035');

  // Preflight balances across all target chains before mutating on-chain state.
  const autoBalance = await automation.public.getBalance({ address: owner.address });
  if (autoBalance === 0n) {
    throw new Error(
      `Signer ${owner.address} has 0 ${automation.chain.nativeCurrency.symbol} on ${automation.config.name} (${AUTOMATION_CHAIN_ID}).`,
    );
  }
  for (const chainId of targetChains) {
    const fundsNet = fundsConnections.get(chainId)!;
    const [nativeBalance, usdcBalance] = await Promise.all([
      fundsNet.public.getBalance({ address: owner.address }),
      fundsNet.public.readContract({
        address: fundsNet.config.usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner.address],
      }),
    ]);
    if (nativeBalance === 0n) {
      throw new Error(`Signer ${owner.address} has 0 ETH on ${fundsNet.config.name} (${chainId}).`);
    }
    if (usdcBalance < SMOKE_MIN_TOTAL_USDC) {
      throw new Error(
        `Signer ${owner.address} needs at least ${formatUnits(SMOKE_MIN_TOTAL_USDC, 6)} USDC on ${fundsNet.config.name} (${chainId}), found ${formatUnits(usdcBalance, 6)} USDC.`,
      );
    }
  }

  async function ensureAgent(): Promise<Address> {
    let agent = await automation.public.readContract({
      address: agentFactory,
      abi: workflowAgentFactoryV2Abi,
      functionName: 'agentOf',
      args: [owner.address],
    });
    if (agent === zeroAddress) {
      await send(
        automation,
        agentFactory,
        encodeFunctionData({ abi: workflowAgentFactoryV2Abi, functionName: 'create' }),
      );
      agent = await automation.public.readContract({
        address: agentFactory,
        abi: workflowAgentFactoryV2Abi,
        functionName: 'agentOf',
        args: [owner.address],
      });
    }
    if (agent === zeroAddress) {
      throw new Error('Failed to resolve Agent address after factory create().');
    }
    return agent;
  }

  async function ensureAgentReserve(agent: Address) {
    const reserve = await automation.public.readContract({
      address: automation.config.systemContract,
      abi: executionCreditAbi,
      functionName: 'reserves',
      args: [agent],
    });
    if (reserve < autoTargetReserve) {
      const needed = autoTargetReserve - reserve;
      const balance = await automation.public.getBalance({ address: owner.address });
      if (balance < needed) {
        throw new Error(
          `Signer ${owner.address} needs ${formatEther(needed)} ${automation.chain.nativeCurrency.symbol} on ${automation.config.name} to top up Agent credit, has ${formatEther(balance)}.`,
        );
      }
      await send(
        automation,
        automation.config.systemContract,
        encodeFunctionData({
          abi: executionCreditAbi,
          functionName: 'depositTo',
          args: [agent],
        }),
        needed,
      );
    }
  }

  async function ensureVaultForChain(
    fundsNet: ReturnType<typeof connection<FundsChainId>>,
    vaultFactory: Address,
    agent: Address,
  ): Promise<Address> {
    let vault = await fundsNet.public.readContract({
      address: vaultFactory,
      abi: workflowVaultFactoryV2Abi,
      functionName: 'vaultOf',
      args: [owner.address],
    });
    if (vault === zeroAddress) {
      await send(
        fundsNet,
        vaultFactory,
        encodeFunctionData({
          abi: workflowVaultFactoryV2Abi,
          functionName: 'create',
          args: [agent],
        }),
      );
      vault = await fundsNet.public.readContract({
        address: vaultFactory,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'vaultOf',
        args: [owner.address],
      });
    }
    if (vault === zeroAddress) {
      throw new Error(`Failed to resolve Vault address on ${fundsNet.config.name} after create().`);
    }

    const linked = await automation.public.readContract({
      address: agent,
      abi: workflowAgentV2Abi,
      functionName: 'vaults',
      args: [fundsNet.chain.id],
    });
    if (linked === zeroAddress) {
      await send(
        automation,
        agent,
        encodeFunctionData({
          abi: workflowAgentV2Abi,
          functionName: 'linkVault',
          args: [fundsNet.chain.id, vault],
        }),
      );
    } else if (linked.toLowerCase() !== vault.toLowerCase()) {
      throw new Error(
        `The Agent ${agent} is linked to a different Vault (${linked}) on ${fundsNet.config.name} than ${vault}.`,
      );
    }

    const reserve = await fundsNet.public.readContract({
      address: fundsNet.config.callbackProxy,
      abi: executionCreditAbi,
      functionName: 'reserves',
      args: [vault],
    });
    if (reserve < settlementTargetReserve) {
      const needed = settlementTargetReserve - reserve;
      const balance = await fundsNet.public.getBalance({ address: owner.address });
      if (balance < needed) {
        throw new Error(
          `Signer ${owner.address} needs ${formatEther(needed)} ETH on ${fundsNet.config.name} to top up Vault callback credit, has ${formatEther(balance)}.`,
        );
      }
      await send(
        fundsNet,
        fundsNet.config.callbackProxy,
        encodeFunctionData({
          abi: executionCreditAbi,
          functionName: 'depositTo',
          args: [vault],
        }),
        needed,
      );
    }

    return vault;
  }

  const abortController = new AbortController();
  let signalHits = 0;
  const onSignal = (signalName: NodeJS.Signals) => {
    signalHits += 1;
    if (signalHits === 1) {
      process.stderr.write(
        `\nReceived ${signalName}; aborting observation and running workflow cleanup...\n`,
      );
      abortController.abort();
      return;
    }
    process.stderr.write(`\nReceived second ${signalName}; exiting immediately.\n`);
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const throwIfAborted = () => {
    if (abortController.signal.aborted) {
      throw new Error('Smoke aborted by signal.');
    }
  };

  try {
    throwIfAborted();
    const agent = await ensureAgent();
    const chainResults: Record<string, ChainSmokeEvidence> = {};

    for (const fundsChainId of targetChains) {
      throwIfAborted();

      const fundsNet = fundsConnections.get(fundsChainId)!;
      const vaultFactoryInfo = vaultFactoryEntries.get(fundsChainId)!;
      process.stdout.write(
        `\n=== Running Workflow V2 smoke on ${fundsNet.config.name} (${fundsChainId}) ===\n`,
      );

      await ensureAgentReserve(agent);
      throwIfAborted();
      const vault = await ensureVaultForChain(fundsNet, vaultFactoryInfo.address, agent);
      throwIfAborted();

      const retireDeps: RetireWorkflowDeps = {
        readVaultAuthorization: async (workflowId) => {
          const auth = await fundsNet.public.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'authorizations',
            args: [workflowId],
          });
          return { epoch: auth[1], active: auth[3] };
        },
        readAgentEntry: async (workflowId) => {
          const entry = await automation.public.readContract({
            address: agent,
            abi: workflowAgentV2Abi,
            functionName: 'entries',
            args: [workflowId],
          });
          return { epoch: entry[1], trigger: entry[4], chain: entry[5] };
        },
        revokeOnVault: async (workflowId, epoch) => {
          const tx = await send(
            fundsNet,
            vault,
            encodeFunctionData({
              abi: workflowVaultV2Abi,
              functionName: 'revoke',
              args: [workflowId, epoch],
            }),
          );
          process.stdout.write(
            `Revoked ${workflowId} (epoch ${epoch}) on ${fundsNet.config.name} Vault ${vault}: ${tx.transactionHash}\n`,
          );
          return tx.transactionHash;
        },
        disableOnAgent: async (workflowId, epoch) => {
          const tx = await send(
            automation,
            agent,
            encodeFunctionData({
              abi: workflowAgentV2Abi,
              functionName: 'disable',
              args: [workflowId, epoch],
            }),
          );
          process.stdout.write(
            `Disabled ${workflowId} (epoch ${epoch}) on ${automation.config.name} Agent ${agent}: ${tx.transactionHash}\n`,
          );
          return tx.transactionHash;
        },
      };

      const { retired: retiredStaleWorkflows } = await retireStaleWorkflowsForChain({
        fundsChainId,
        readPaymentWorkflow: () =>
          fundsNet.public.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'paymentWorkflow',
          }),
        readAgentWorkflowIds: () =>
          automation.public.readContract({
            address: agent,
            abi: workflowAgentV2Abi,
            functionName: 'workflowIds',
          }),
        readAgentEntry: retireDeps.readAgentEntry,
        readAgentTitle: (workflowId) =>
          automation.public.readContract({
            address: agent,
            abi: workflowAgentV2Abi,
            functionName: 'titles',
            args: [workflowId],
          }),
        readVaultWorkflowIds: () =>
          fundsNet.public.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'workflowIds',
          }),
        readVaultAuthorization: retireDeps.readVaultAuthorization,
        readVaultTitle: (workflowId) =>
          fundsNet.public.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'titles',
            args: [workflowId],
          }),
        retire: (workflowId) => retireWorkflow(workflowId, retireDeps),
      });

      interface ActivatedWorkflow {
        id: Hex;
        hash: Hex;
        authorized: { transactionHash: Hex; blockNumber: bigint };
        title: string;
        window: { automation: bigint; funds: bigint };
      }

      async function activate(
        program: WorkflowV2Program,
        title: string,
        weeklyUsdc: bigint,
        trackWorkflow: (id: Hex) => void,
      ): Promise<ActivatedWorkflow> {
        const encoded = encodeWorkflowV2(program);
        const hash = keccak256(encoded);
        const id = keccak256(randomBytes(32));
        const auth = await fundsNet.public.readContract({
          address: vault,
          abi: workflowVaultV2Abi,
          functionName: 'authorizations',
          args: [id],
        });
        const epoch = auth[1] + 1n;
        const args = [id, epoch, encoded, title, weeklyUsdc, 0n] as const;
        await fundsNet.public.simulateContract({
          address: vault,
          abi: workflowVaultV2Abi,
          functionName: 'authorizeWithWeeklyBudget',
          args,
          account: owner,
        });
        throwIfAborted();
        trackWorkflow(id);
        const authorized = await send(
          fundsNet,
          vault,
          encodeFunctionData({
            abi: workflowVaultV2Abi,
            functionName: 'authorizeWithWeeklyBudget',
            args,
          }),
        );
        const [confirmed, weekly] = await Promise.all([
          fundsNet.public.readContract({
            address: vault,
            abi: workflowVaultV2Abi,
            functionName: 'authorizations',
            args: [id],
          }),
          weeklyUsdc > 0n
            ? fundsNet.public.readContract({
                address: vault,
                abi: workflowVaultV2Abi,
                functionName: 'weeklyBudget',
                args: [id],
              })
            : Promise.resolve(null),
        ]);
        throwIfAborted();
        const enableData = weekly
          ? encodeFunctionData({
              abi: workflowAgentV2Abi,
              functionName: 'enableWithBudget',
              args: [
                id,
                epoch,
                encoded,
                title,
                confirmed[2],
                {
                  usdcLimit: weekly[0],
                  wethLimit: weekly[1],
                  usdcSpent: weekly[2],
                  wethSpent: weekly[3],
                  weekStart: weekly[6] >= 604_800n ? weekly[6] - 604_800n : 0n,
                  revision: weekly[7],
                },
              ],
            })
          : encodeFunctionData({
              abi: workflowAgentV2Abi,
              functionName: 'enable',
              args: [id, epoch, encoded, title, confirmed[2]],
            });
        await send(automation, agent, enableData);
        const window = {
          automation: await automation.public.getBlockNumber(),
          funds: await fundsNet.public.getBlockNumber(),
        };
        return { id, hash, authorized, title, window };
      }

      async function finish(
        label: string,
        decision: { transactionHash: Hex; args: { runId: Hex; originTransaction: Hex } },
        settled: {
          transactionHash: Hex;
          blockNumber: bigint;
          args: { status: number; path: number };
        },
        expectedPath: number,
        expectedStatus: number,
      ): Promise<SmokeRunEvidence> {
        if (settled.args.path !== expectedPath) {
          throw new Error(
            `${label} took the wrong path (expected ${expectedPath}, got ${settled.args.path}).`,
          );
        }
        if (settled.args.status !== expectedStatus) {
          throw new Error(`${label} settled as ${statuses[settled.args.status]}.`);
        }
        const steps = await fundsNet.public.getLogs({
          address: vault,
          event: step,
          args: { runId: decision.args.runId },
          fromBlock: settled.blockNumber,
          toBlock: settled.blockNumber,
          strict: true,
        });
        const spent = steps.reduce((total, entry) => total + (entry.args.spent ?? 0n), 0n);
        const run: SmokeRunEvidence = {
          spentUsdcBaseUnits: spent.toString(),
          runId: decision.args.runId,
          path: settled.args.path,
          status: statuses[settled.args.status] ?? 'unknown',
          originTransaction: decision.args.originTransaction,
          lasnaTransaction: decision.transactionHash,
          destinationTransaction: settled.transactionHash,
        };
        process.stdout.write(`${label} ${JSON.stringify(run)}\n`);
        return run;
      }

      /** Waits for one dispatch of a workflow, then for its settlement on the funds chain. */
      async function proof(
        label: string,
        workflow: ActivatedWorkflow,
        expectedPath: number,
        expectedStatus: number,
        origin?: Hex,
        originBlock?: bigint,
      ): Promise<SmokeRunEvidence> {
        const until = Date.now() + 600_000;
        let autoCursor = workflow.window.automation;
        const fundsStart =
          originBlock && originBlock > workflow.window.funds ? originBlock : workflow.window.funds;
        let fundsCursor = fundsStart;
        while (Date.now() < until) {
          if (abortController.signal.aborted) {
            throw new Error(`${label} observation aborted.`);
          }
          const { logs: decisions, lastScannedBlock: autoScanned } = await getLogsChunked(
            () => automation.public.getBlockNumber({ cacheTime: 0 }),
            ({ fromBlock, toBlock }) =>
              automation.public.getLogs({
                address: agent,
                event: dispatched,
                args: { workflow: workflow.id },
                fromBlock,
                toBlock,
                strict: true,
              }),
            autoCursor,
          );
          const match = origin
            ? decisions.find(
                (event) => event.args.originTransaction?.toLowerCase() === origin.toLowerCase(),
              )
            : decisions[0];
          if (!match) {
            autoCursor = nextLogScanCursor(workflow.window.automation, autoCursor, autoScanned);
            await delay(6_000, abortController.signal);
            continue;
          }
          for (let attempt = 0; attempt < 40; attempt += 1) {
            if (abortController.signal.aborted) {
              throw new Error(`${label} settlement observation aborted.`);
            }
            const { logs: settled, lastScannedBlock: fundsScanned } = await getLogsChunked(
              () => fundsNet.public.getBlockNumber({ cacheTime: 0 }),
              ({ fromBlock, toBlock }) =>
                fundsNet.public.getLogs({
                  address: vault,
                  event: outcome,
                  args: { runId: match.args.runId },
                  fromBlock,
                  toBlock,
                  strict: true,
                }),
              fundsCursor,
            );
            if (settled.length) {
              return finish(label, match, settled[0]!, expectedPath, expectedStatus);
            }
            fundsCursor = nextLogScanCursor(fundsStart, fundsCursor, fundsScanned);
            await delay(6_000, abortController.signal);
          }
          throw new Error(`${label} dispatched but never settled.`);
        }
        throw new Error(`${label} was not dispatched within the live observation window.`);
      }

      const weeklyUsdc = parseUnits('1', 6);
      const { result: verified, cleanups } = await runWithWorkflowCleanup(
        async (trackWorkflow) => {
          const sweepProgram = createWorkflowV2Recipe(
            'income-sweep',
            {
              minimumPaymentUsdc: '1',
              sendUsdc: '0.20',
              smallPaymentUsdc: '0.25',
              smallSweepUsdc: '0.05',
              recipient,
            },
            { chain: fundsChainId, originChain: fundsChainId },
          );
          const sweep = await activate(
            sweepProgram,
            SMOKE_WORKFLOW_TITLES[0],
            weeklyUsdc,
            trackWorkflow,
          );

          const runs: Array<SmokeRunEvidence & { inputUsdcBaseUnits: string }> = [];
          for (const [amount, path, status] of [
            [SMOKE_TRANSFER_AMOUNTS[0], 1, 1],
            [SMOKE_TRANSFER_AMOUNTS[1], 3, 1],
            [SMOKE_TRANSFER_AMOUNTS[2], 4, 2],
          ] as const) {
            throwIfAborted();
            const origin = await send(
              fundsNet,
              fundsNet.config.usdc,
              encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transfer',
                args: [vault, parseUnits(amount, 6)],
              }),
            );
            const run = await proof(
              `[${fundsNet.config.name}] Payment ${amount} USDC`,
              sweep,
              path,
              status,
              origin.transactionHash,
              origin.blockNumber,
            );
            runs.push({ ...run, inputUsdcBaseUnits: parseUnits(amount, 6).toString() });
          }

          // A scheduled buy proves the Cron100 limb on the same pair; the Vault swaps and pays the fee.
          const scheduleProgram = createWorkflowV2Recipe(
            'scheduled-buy',
            {
              buyUsdc: SMOKE_SCHEDULE_BUY_USDC,
              slippagePercent: smokeSlippagePercent(fundsChainId),
              intervalSeconds: '3600',
            },
            { chain: fundsChainId, originChain: fundsChainId },
          );
          const schedule = await activate(
            scheduleProgram,
            SMOKE_WORKFLOW_TITLES[1],
            weeklyUsdc,
            trackWorkflow,
          );
          const scheduledRun = await proof(
            `[${fundsNet.config.name}] Scheduled buy`,
            schedule,
            0,
            1,
          );

          return { sweep, runs, schedule, scheduledRun };
        },
        (workflowId) => retireWorkflow(workflowId, retireDeps),
        (message) => process.stderr.write(`${message}\n`),
      );

      const cleanupFor = (workflowId: Hex): SmokeCleanupReceipt => {
        const found = cleanups.find(
          (item) => item.workflowId.toLowerCase() === workflowId.toLowerCase(),
        );
        return {
          vaultRevokeTransaction: found?.vaultRevokeTransaction ?? null,
          agentDisableTransaction: found?.agentDisableTransaction ?? null,
        };
      };

      chainResults[String(fundsChainId)] = {
        chainId: fundsChainId,
        chainName: fundsNet.config.name,
        vaultFactory: vaultFactoryInfo.address,
        deploymentCommit: vaultFactoryInfo.commit?.slice(0, 7),
        vault,
        retiredStaleWorkflows,
        sweep: {
          title: verified.sweep.title,
          workflow: verified.sweep.id,
          programHash: verified.sweep.hash,
          authorizationTransaction: verified.sweep.authorized.transactionHash,
          weeklyUsdcLimitBaseUnits: weeklyUsdc.toString(),
          runs: verified.runs,
          cleanup: cleanupFor(verified.sweep.id),
        },
        schedule: {
          title: verified.schedule.title,
          workflow: verified.schedule.id,
          programHash: verified.schedule.hash,
          authorizationTransaction: verified.schedule.authorized.transactionHash,
          run: verified.scheduledRun,
          cleanup: cleanupFor(verified.schedule.id),
        },
      };
    }

    const nextEvidence: SmokeEvidence = {
      network: IS_MAINNET ? 'mainnet' : 'testnet',
      automationChainId: AUTOMATION_CHAIN_ID,
      agentFactory,
      deploymentCommit: agentFactoryEntry.commit?.slice(0, 7),
      agent,
      recipient,
      chains: chainResults,
    };

    const smokeUrl = new URL(SMOKE_FILE, import.meta.url);
    let existingEvidence: unknown = null;
    try {
      existingEvidence = JSON.parse(await readFile(smokeUrl, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error;
      }
    }
    const mergedEvidence = mergeSmokeEvidence(existingEvidence, nextEvidence);
    await writeFile(smokeUrl, JSON.stringify(mergedEvidence, null, 2) + '\n');
    process.stdout.write(`Wrote ${SMOKE_FILE.replace('../', '')}\n`);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const entry = resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
}

if (isMainModule()) {
  void main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  });
}
