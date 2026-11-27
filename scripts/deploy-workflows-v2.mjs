#!/usr/bin/env node
/**
 * One-command Workflow V2 release.
 *
 * Deploys the Agent factory on Reactive Lasna (or Reactive Mainnet with `--mainnet`) and the
 * Vault factory on Unichain and Base from `DeployWorkflowsV2.s.sol`, writes the deployment record
 * from the broadcast receipts, points the local backend and frontend environment files at the new
 * pair, and updates the Heroku deployment config var.
 *
 * `--check` performs no deployment: it verifies that the record, the local environment files,
 * and Heroku agree and that the factories have code on chain. Use it in preflight and CI.
 * `--record-only` rebuilds the record from the existing Foundry broadcast receipts without
 * deploying, which recovers a lost record or one written by hand.
 *
 * Env: DEPLOYER_PRIVATE_KEY (or MAINNET_DEPLOYER_PRIVATE_KEY with `--mainnet`),
 * LASNA_RPC_URL / UNICHAIN_RPC_URL / BASE_SEPOLIA_RPC_URL (or REACTIVE_MAINNET_RPC_URL /
 * UNICHAIN_MAINNET_RPC_URL / BASE_MAINNET_RPC_URL), optional LASNA_FEE_CAP,
 * REACTIVE_MAINNET_FEE_CAP, FORGE_GAS_ESTIMATE_MULTIPLIER, FORGE_PATH, HEROKU_APP_NAME (or
 * --heroku-app), and HEROKU_API_KEY (otherwise read from the Heroku CLI).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  concat,
  createPublicClient,
  encodeAbiParameters,
  formatEther,
  formatGwei,
  http,
  keccak256,
  parseEther,
} from 'viem';
import { resolveFoundryBinary } from './foundry-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONTRACTS = join(ROOT, 'contracts');
const IS_MAINNET = process.argv.includes('--mainnet');
const RECORD_PATH = join(
  ROOT,
  'deployments',
  IS_MAINNET ? 'workflows-v2-mainnet.json' : 'workflows-v2.json',
);
const BACKEND_ENV_KEY = IS_MAINNET ? 'WORKFLOW_V2_MAINNET_DEPLOYMENT' : 'WORKFLOW_V2_DEPLOYMENT';
const FRONTEND_ENV_KEY = IS_MAINNET
  ? 'VITE_WORKFLOW_V2_MAINNET_DEPLOYMENT'
  : 'VITE_WORKFLOW_V2_DEPLOYMENT';
const SCRIPT = 'script/DeployWorkflowsV2.s.sol';
const FORGE = resolveFoundryBinary('forge', process.env.FORGE_PATH);
export const LASNA_DEFAULT_FEE_CAP = 950_000_000_000_000_000n;
export const REACTIVE_MAINNET_DEFAULT_FEE_CAP = 5_000_000_000_000_000_000n;
export const DEFAULT_GAS_ESTIMATE_MULTIPLIER = 130n;
const GWEI = 1_000_000_000n;
const AUTOMATION_KEY = IS_MAINNET ? 'reactive' : 'lasna';

export const TESTNET_CHAINS = {
  lasna: {
    id: 5318007,
    contract: 'WorkflowAgentFactoryV2',
    name: 'Reactive Lasna',
    nativeSymbol: 'lREACT',
    explorer: 'https://lasna.reactscan.net',
    rpcEnv: 'LASNA_RPC_URL',
    defaultRpc: 'https://lasna-rpc.rnk.dev/',
    feeCapEnv: 'LASNA_FEE_CAP',
    defaultFeeCap: LASNA_DEFAULT_FEE_CAP,
  },
  unichain: {
    id: 1301,
    contract: 'WorkflowVaultFactoryV2',
    name: 'Unichain Sepolia',
    nativeSymbol: 'ETH',
    explorer: 'https://sepolia.uniscan.xyz',
    rpcEnv: 'UNICHAIN_RPC_URL',
    defaultRpc: 'https://sepolia.unichain.org',
  },
  base: {
    id: 84532,
    contract: 'WorkflowVaultFactoryV2',
    name: 'Base Sepolia',
    nativeSymbol: 'ETH',
    explorer: 'https://sepolia.basescan.org',
    rpcEnv: 'BASE_SEPOLIA_RPC_URL',
    defaultRpc: 'https://sepolia.base.org',
  },
};

export const MAINNET_CHAINS = {
  reactive: {
    id: 1597,
    contract: 'WorkflowAgentFactoryV2',
    name: 'Reactive Mainnet',
    nativeSymbol: 'REACT',
    explorer: 'https://reactscan.net',
    rpcEnv: 'REACTIVE_MAINNET_RPC_URL',
    defaultRpc: 'https://mainnet-rpc.rnk.dev/',
    feeCapEnv: 'REACTIVE_MAINNET_FEE_CAP',
    defaultFeeCap: REACTIVE_MAINNET_DEFAULT_FEE_CAP,
  },
  unichain: {
    id: 130,
    contract: 'WorkflowVaultFactoryV2',
    name: 'Unichain',
    nativeSymbol: 'ETH',
    explorer: 'https://uniscan.xyz',
    rpcEnv: 'UNICHAIN_MAINNET_RPC_URL',
    defaultRpc: 'https://mainnet.unichain.org',
  },
  base: {
    id: 8453,
    contract: 'WorkflowVaultFactoryV2',
    name: 'Base',
    nativeSymbol: 'ETH',
    explorer: 'https://basescan.org',
    rpcEnv: 'BASE_MAINNET_RPC_URL',
    defaultRpc: 'https://mainnet.base.org',
  },
};

const CHAINS = IS_MAINNET ? MAINNET_CHAINS : TESTNET_CHAINS;

function fail(message) {
  throw new Error(message);
}

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Set ${name} before running the Workflow V2 release.`);
  return value;
}

function rpcUrl(chain) {
  return process.env[chain.rpcEnv]?.trim() || chain.defaultRpc || env(chain.rpcEnv);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function client(rpc) {
  return createPublicClient({ transport: http(rpc, { timeout: 30_000 }) });
}

function forge(args, extraEnv = undefined) {
  return execFileSync(FORGE, args, {
    cwd: CONTRACTS,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
  });
}

function deploymentValue(
  record,
  { chains = CHAINS, automationKey = AUTOMATION_KEY, recordPath = RECORD_PATH } = {},
) {
  const automationChain = chains[automationKey];
  const automation = record.find(
    (entry) => entry.contract === automationChain.contract && entry.chainId === automationChain.id,
  );
  const unichain = record.find(
    (entry) => entry.contract === chains.unichain.contract && entry.chainId === chains.unichain.id,
  );
  const base = record.find(
    (entry) => entry.contract === chains.base.contract && entry.chainId === chains.base.id,
  );
  if (!automation || !unichain) fail(`${recordPath} is missing the factory pair.`);
  return JSON.stringify({
    [automationKey]: { factory: automation.address, startBlock: automation.blockNumber },
    unichain: { factory: unichain.address, startBlock: unichain.blockNumber },
    ...(base ? { base: { factory: base.address, startBlock: base.blockNumber } } : {}),
  });
}

function setEnvLine(file, key, value) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const next = pattern.test(text)
    ? text.replace(pattern, line)
    : `${text.replace(/\n?$/, '\n')}${line}\n`;
  if (next === text) return false;
  writeFileSync(file, next);
  return true;
}

async function herokuToken() {
  if (process.env.HEROKU_API_KEY?.trim()) return process.env.HEROKU_API_KEY.trim();
  const cli = process.platform === 'win32' ? 'heroku.cmd' : 'heroku';
  try {
    return execFileSync(cli, ['auth:token'], { encoding: 'utf8' }).trim();
  } catch {
    try {
      // Windows PATH entries from Git Bash are not always visible to execFileSync.
      return execFileSync('heroku', ['auth:token'], { shell: true, encoding: 'utf8' }).trim();
    } catch {
      return undefined;
    }
  }
}

async function heroku(init = {}) {
  const app = process.env.HEROKU_APP_NAME?.trim() ?? cliApp();
  if (!app) return { app: undefined };
  const token = await herokuToken();
  if (!token) fail('Set HEROKU_API_KEY to update the Heroku config var.');
  const response = await fetch(`https://api.heroku.com/apps/${app}/config-vars`, {
    ...init,
    headers: {
      Accept: 'application/vnd.heroku+json; version=3',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail(`Heroku returned HTTP ${response.status} for ${app}.`);
  return { app, config: await response.json() };
}

function cliApp() {
  const index = process.argv.indexOf('--heroku-app');
  return index === -1 ? undefined : process.argv[index + 1];
}

export function resolveFeeCap(chain, envMap = process.env) {
  const raw = chain.feeCapEnv ? envMap[chain.feeCapEnv]?.trim() : undefined;
  if (!raw) return chain.defaultFeeCap;
  if (!/^\d+(?:\.\d{1,18})?$/.test(raw)) {
    fail(
      `${chain.feeCapEnv} must be a positive ${chain.nativeSymbol} amount (e.g. "5" or "3.5"), got "${raw}".`,
    );
  }
  const cap = parseEther(raw);
  if (cap <= 0n) {
    fail(
      `${chain.feeCapEnv} must be a positive ${chain.nativeSymbol} amount (e.g. "5" or "3.5"), got "${raw}".`,
    );
  }
  return cap;
}

export function resolveGasEstimateMultiplier(envMap = process.env) {
  const raw = envMap.FORGE_GAS_ESTIMATE_MULTIPLIER?.trim();
  if (!raw) return DEFAULT_GAS_ESTIMATE_MULTIPLIER;
  if (!/^\d+$/.test(raw)) {
    fail(
      `FORGE_GAS_ESTIMATE_MULTIPLIER must be an integer percentage >= 100 (e.g. "130"), got "${raw}".`,
    );
  }
  const multiplier = BigInt(raw);
  if (multiplier < 100n) {
    fail(
      `FORGE_GAS_ESTIMATE_MULTIPLIER must be an integer percentage >= 100 (e.g. "130"), got "${raw}".`,
    );
  }
  return multiplier;
}

export function computeAutomationGasPlan({
  chain,
  estimatedGas,
  suggestedGasPrice,
  balance,
  feeCap,
  gasEstimateMultiplier = DEFAULT_GAS_ESTIMATE_MULTIPLIER,
}) {
  if (estimatedGas <= 0n) {
    fail(`Invalid gas estimate for ${chain.name}: ${estimatedGas}.`);
  }
  if (suggestedGasPrice <= 0n) {
    fail(`Invalid suggested gas price for ${chain.name}: ${suggestedGasPrice}.`);
  }
  if (feeCap <= 0n) {
    fail(`Invalid fee cap for ${chain.name}: ${feeCap}.`);
  }
  if (gasEstimateMultiplier < 100n) {
    fail(`Invalid gas estimate multiplier for ${chain.name}: ${gasEstimateMultiplier}.`);
  }
  if (balance < 0n) {
    fail(`Invalid balance for ${chain.name}: ${balance}.`);
  }

  // Round up so preflight never underestimates Foundry's `--gas-estimate-multiplier` limit.
  const broadcastGas = (estimatedGas * gasEstimateMultiplier + 99n) / 100n;
  const minGasPrice =
    suggestedGasPrice >= GWEI ? (suggestedGasPrice / GWEI + 1n) * GWEI : suggestedGasPrice + 1n;
  const minRequiredBalance = minGasPrice * broadcastGas;
  const budget = balance < feeCap ? balance : feeCap;
  const ceiling = budget / broadcastGas;

  if (balance < minRequiredBalance) {
    fail(
      `The deployer needs more ${chain.nativeSymbol} on ${chain.name}: balance ${formatEther(balance)} ${chain.nativeSymbol}, minimum required ${formatEther(minRequiredBalance)} ${chain.nativeSymbol} for ${broadcastGas} broadcast gas (${estimatedGas} simulated * ${gasEstimateMultiplier}%) above suggested ${formatGwei(suggestedGasPrice)} gwei.`,
    );
  }
  if (feeCap < minRequiredBalance) {
    const overrideHint = chain.feeCapEnv ? ` Raise ${chain.feeCapEnv} to override.` : '';
    fail(
      `${chain.name} fee cap ${formatEther(feeCap)} ${chain.nativeSymbol} leaves no headroom for ${broadcastGas} broadcast gas (${estimatedGas} simulated * ${gasEstimateMultiplier}%): suggested ${formatGwei(suggestedGasPrice)} gwei, ceiling ${formatGwei(ceiling)} gwei.${overrideHint}`,
    );
  }

  const target = suggestedGasPrice * 2n < ceiling ? suggestedGasPrice * 2n : ceiling;
  const gasPrice = target >= GWEI ? (target / GWEI) * GWEI : target;
  const requiredBalance = gasPrice * broadcastGas;

  if (gasPrice <= suggestedGasPrice || balance < requiredBalance) {
    fail(
      `${chain.name} gas plan failed invariant check: gasPrice ${formatGwei(gasPrice)} gwei (suggested ${formatGwei(suggestedGasPrice)} gwei), required ${formatEther(requiredBalance)} ${chain.nativeSymbol}, balance ${formatEther(balance)} ${chain.nativeSymbol}.`,
    );
  }

  const gasPriceArg = gasPrice % GWEI === 0n ? `${gasPrice / GWEI}gwei` : String(gasPrice);
  return {
    estimatedGas,
    broadcastGas,
    gasEstimateMultiplier,
    feeCap,
    budget,
    ceiling,
    gasPrice,
    gasPriceArg,
    requiredBalance,
  };
}

async function deploy(chain, account, deployerKey) {
  const rpc = rpcUrl(chain);
  const publicClient = client(rpc);
  const args = ['script', SCRIPT, '--rpc-url', rpc];
  const forgeEnv = deployerKey ? { DEPLOYER_PRIVATE_KEY: deployerKey } : undefined;
  if (chain === CHAINS[AUTOMATION_KEY]) {
    const simulation = forge(args, forgeEnv);
    const gas = simulation.match(/Estimated total gas used for script:\s*(\d+)/)?.[1];
    if (!gas) fail(`Could not read the ${chain.name} gas estimate from the dry run.`);
    const [suggestedGasPrice, balance] = await Promise.all([
      publicClient.getGasPrice(),
      publicClient.getBalance({ address: account }),
    ]);
    const feeCap = resolveFeeCap(chain);
    const gasEstimateMultiplier = resolveGasEstimateMultiplier();
    const plan = computeAutomationGasPlan({
      chain,
      estimatedGas: BigInt(gas),
      suggestedGasPrice,
      balance,
      feeCap,
      gasEstimateMultiplier,
    });
    console.log(
      `${chain.name} gas plan: ${plan.estimatedGas} simulated -> ${plan.broadcastGas} broadcast (${plan.gasEstimateMultiplier}%) at ${formatGwei(plan.gasPrice)} gwei (suggested ${formatGwei(suggestedGasPrice)} gwei, max fee ${formatEther(plan.requiredBalance)} / cap ${formatEther(plan.feeCap)} ${chain.nativeSymbol})`,
    );
    args.push(
      '--legacy',
      '--with-gas-price',
      plan.gasPriceArg,
      '--gas-estimate-multiplier',
      String(plan.gasEstimateMultiplier),
    );
  }
  forge([...args, '--broadcast', '--start-fresh'], forgeEnv);
  return readBroadcast(chain.id);
}

function broadcastPath(chainId) {
  return join(
    CONTRACTS,
    'broadcast',
    'DeployWorkflowsV2.s.sol',
    String(chainId),
    'run-latest.json',
  );
}

function readBroadcast(chainId) {
  const path = broadcastPath(chainId);
  if (!existsSync(path)) fail(`Missing broadcast receipts at ${path}.`);
  const broadcast = JSON.parse(readFileSync(path, 'utf8'));
  const creation = (broadcast.transactions ?? []).find(
    (transaction) =>
      transaction.transactionType === 'CREATE' && transaction.contractAddress && transaction.hash,
  );
  if (!creation) fail(`No creation transaction found in ${path}.`);
  return creation;
}

async function entry(chain, creation, source) {
  const rpc = rpcUrl(chain);
  const publicClient = client(rpc);
  const transaction = await publicClient.getTransaction({ hash: creation.hash });
  const receipt = await publicClient.getTransactionReceipt({ hash: creation.hash });
  if (receipt.status !== 'success') fail(`${chain.name} deployment reverted.`);
  const address = (receipt.contractAddress ?? creation.contractAddress).toLowerCase();
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const code = await publicClient.getCode({ address });
  if (!code || code === '0x') fail(`${chain.name} factory has no code at ${address}.`);
  return {
    name: chain.name,
    chainId: chain.id,
    contract: chain.contract,
    address,
    blockNumber: Number(receipt.blockNumber),
    transactionHash: transaction.hash,
    explorer: `${chain.explorer}/tx/${transaction.hash}`,
    ...source,
    confirmedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    creationInputHash: keccak256(transaction.input),
    runtimeCodeHash: keccak256(code),
  };
}

const LASNA_SYSTEM_CONTRACT = '0x8888888888888888888888888888888888888888';

function expectedCreationInputHash(chain, artifact) {
  const bytecode = artifact?.bytecode?.object;
  if (!bytecode) return undefined;
  if (chain.contract === CHAINS[AUTOMATION_KEY].contract) {
    const args = encodeAbiParameters([{ type: 'address' }], [LASNA_SYSTEM_CONTRACT]);
    return keccak256(concat([bytecode, args]));
  }
  return keccak256(bytecode);
}

export async function verifyDeploymentRecord({
  recordPath = RECORD_PATH,
  rootDir = ROOT,
  contractsDir = CONTRACTS,
  offline = false,
  allowContractDrift = false,
  requireBase = false,
  isMainnet = IS_MAINNET,
  chains = CHAINS,
  automationKey = AUTOMATION_KEY,
  backendEnvKey = BACKEND_ENV_KEY,
  frontendEnvKey = FRONTEND_ENV_KEY,
  warn = (message) => console.warn(message),
  readCode,
  readHeroku,
} = {}) {
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  if (!Array.isArray(record)) fail(`${recordPath} must be a JSON array.`);
  const expected = deploymentValue(record, { chains, automationKey, recordPath });
  const problems = [];
  const warnings = [];
  for (const chain of [chains[automationKey], chains.unichain, chains.base]) {
    const item = record.find((row) => row.contract === chain.contract && row.chainId === chain.id);
    if (!item) {
      if (chain !== chains.base || requireBase) {
        problems.push(`missing ${chain.contract} record for ${chain.name}`);
      }
      continue;
    }
    if (
      item.source !== 'commit' ||
      item.dirty !== false ||
      !/^[0-9a-f]{40}$/i.test(item.commit ?? '')
    ) {
      problems.push(
        `${chain.contract} on ${chain.name} must record a clean 40-character commit (source: "commit", dirty: false)`,
      );
    }
    const artifactPath = join(
      contractsDir,
      'out',
      `${chain.contract}.sol`,
      `${chain.contract}.json`,
    );
    if (existsSync(artifactPath) && item.creationInputHash) {
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      const compiledCreationHash = expectedCreationInputHash(chain, artifact);
      if (
        compiledCreationHash &&
        compiledCreationHash.toLowerCase() !== item.creationInputHash.toLowerCase()
      ) {
        const message = `${chain.contract} on ${chain.name} creationInputHash (${item.creationInputHash}) does not match compiled artifact (${compiledCreationHash})`;
        if (allowContractDrift) warnings.push(message);
        else problems.push(message);
      }
    }
    if (!offline) {
      const code = readCode
        ? await readCode(chain, item.address)
        : await client(rpcUrl(chain)).getCode({ address: item.address });
      if (!code || code === '0x') {
        problems.push(`${chain.contract} on ${chain.name} has no code at ${item.address}`);
      } else if (
        item.runtimeCodeHash &&
        keccak256(code).toLowerCase() !== item.runtimeCodeHash.toLowerCase()
      ) {
        problems.push(
          `${chain.contract} on ${chain.name} on-chain runtimeCodeHash does not match the record`,
        );
      }
    }
  }
  for (const [file, key] of [
    [join(rootDir, 'backend', '.env'), backendEnvKey],
    [join(rootDir, 'frontend', '.env.local'), frontendEnvKey],
  ]) {
    if (!existsSync(file)) continue;
    const value = readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];
    if (value?.trim().toLowerCase() !== expected.toLowerCase()) {
      problems.push(`${key} in ${file} does not match the record`);
    }
  }
  if (isMainnet) {
    const testnetRecordPath = join(rootDir, 'deployments', 'workflows-v2.json');
    if (existsSync(testnetRecordPath)) {
      const testnetRecord = JSON.parse(readFileSync(testnetRecordPath, 'utf8'));
      const testnetFactory = testnetRecord.find(
        (row) => row.contract === 'WorkflowAgentFactoryV2' && row.chainId === 5318007,
      )?.address;
      const mainnetFactory = record.find(
        (row) => row.contract === 'WorkflowAgentFactoryV2' && row.chainId === 1597,
      )?.address;
      if (
        testnetFactory &&
        mainnetFactory &&
        testnetFactory.toLowerCase() === mainnetFactory.toLowerCase()
      ) {
        problems.push(
          `Reactive Mainnet WorkflowAgentFactoryV2 (${mainnetFactory}) must not match Reactive Lasna (${testnetFactory})`,
        );
      }
    }
  }
  const herokuState = offline
    ? { app: undefined, config: {} }
    : await (readHeroku ? readHeroku() : heroku());
  if (herokuState.app) {
    if (herokuState.config[backendEnvKey]?.toLowerCase() !== expected.toLowerCase()) {
      problems.push(`Heroku ${backendEnvKey} on ${herokuState.app} does not match the record`);
    }
  }
  if (problems.length) fail(problems.join('\n'));
  for (const warning of warnings) {
    warn(`WARN: ${warning}`);
  }
  return { expected, warnings, herokuApp: herokuState.app };
}

async function verify() {
  const offline = process.argv.includes('--offline');
  const result = await verifyDeploymentRecord({
    offline,
    allowContractDrift: process.argv.includes('--allow-contract-drift'),
    requireBase: process.argv.includes('--base'),
  });
  console.log(
    `Record is consistent with the local environment${offline ? ' (offline check)' : ''}${result.herokuApp ? ` and ${result.herokuApp}` : ''}.`,
  );
}

function revision() {
  const dirty = Boolean(git(['status', '--porcelain']));
  return {
    source: dirty ? 'working-tree' : 'commit',
    commit: git(['rev-parse', 'HEAD']),
    dirty,
  };
}

async function publish(record, source) {
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  const current = existsSync(RECORD_PATH) ? readFileSync(RECORD_PATH, 'utf8') : '';
  const value = deploymentValue(record);
  const files = [];
  for (const [file, name] of [
    [join(ROOT, 'backend', '.env'), BACKEND_ENV_KEY],
    [join(ROOT, 'frontend', '.env.local'), FRONTEND_ENV_KEY],
  ]) {
    if (setEnvLine(file, name, value)) files.push(file);
  }
  // The backend dev watcher reloads its environment when the deployment record changes.
  if (serialized !== current || files.length) writeFileSync(RECORD_PATH, serialized);
  const herokuState = await heroku();
  const app = herokuState.app;
  if (app && herokuState.config[BACKEND_ENV_KEY]?.toLowerCase() !== value.toLowerCase()) {
    await heroku({ method: 'PATCH', body: JSON.stringify({ [BACKEND_ENV_KEY]: value }) });
  }
  for (const item of record) {
    console.log(
      `${item.name}: ${item.contract} ${item.address} block ${item.blockNumber} tx ${item.transactionHash}`,
    );
  }
  console.log(`Record: ${RECORD_PATH}`);
  if (files.length) console.log(`Local env updated: ${files.join(', ')}`);
  if (app) console.log(`Heroku: ${app}`);
  else console.log('Heroku skipped: set HEROKU_APP_NAME or pass --heroku-app.');
  if (source.dirty) {
    console.log('Working tree is dirty: commit this exact tree so the record is reproducible.');
  }
  console.log(`${BACKEND_ENV_KEY}=${value}`);
}

function mergeRecord(existing, updated) {
  const next = existing.filter(
    (item) =>
      !updated.some((row) => row.contract === item.contract && row.chainId === item.chainId),
  );
  return [...next, ...updated];
}

async function release() {
  if (!process.argv.includes('--allow-dirty') && git(['status', '--porcelain'])) {
    fail('Commit working-tree changes before deploying (or pass --allow-dirty for local testing).');
  }
  const key = IS_MAINNET
    ? process.env.MAINNET_DEPLOYER_PRIVATE_KEY?.trim()
    : (process.env.DEPLOYER_PRIVATE_KEY?.trim() ?? process.env.SPONSOR_PRIVATE_KEY?.trim());
  if (!key) {
    fail(
      IS_MAINNET
        ? 'Set a dedicated MAINNET_DEPLOYER_PRIVATE_KEY before deploying to mainnet (never reuse the testnet deployer key).'
        : 'Set DEPLOYER_PRIVATE_KEY (or SPONSOR_PRIVATE_KEY) before deploying.',
    );
  }
  const { privateKeyToAccount } = await import('viem/accounts');
  const wallet = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  if (IS_MAINNET) {
    for (const testnetKeyName of ['DEPLOYER_PRIVATE_KEY', 'SPONSOR_PRIVATE_KEY']) {
      const raw = process.env[testnetKeyName]?.trim();
      if (!raw) continue;
      const testnetWallet = privateKeyToAccount(raw.startsWith('0x') ? raw : `0x${raw}`);
      if (testnetWallet.address.toLowerCase() === wallet.address.toLowerCase()) {
        fail(
          `MAINNET_DEPLOYER_PRIVATE_KEY must not share an address with ${testnetKeyName} (${wallet.address}).`,
        );
      }
    }
  }
  const source = revision();
  const automationOnly =
    process.argv.includes('--lasna-only') || process.argv.includes('--reactive-only');
  const baseOnly = process.argv.includes('--base-only');
  if (automationOnly && baseOnly) {
    fail('Pass at most one of --lasna-only, --reactive-only, or --base-only.');
  }
  const mergeOnly = automationOnly || baseOnly;
  const includeBase =
    !process.argv.includes('--no-base') &&
    (baseOnly ||
      process.argv.includes('--base') ||
      IS_MAINNET ||
      Boolean(process.env[CHAINS.base.rpcEnv]?.trim()));
  const chains = automationOnly
    ? [CHAINS[AUTOMATION_KEY]]
    : baseOnly
      ? [CHAINS.base]
      : [CHAINS[AUTOMATION_KEY], CHAINS.unichain, ...(includeBase ? [CHAINS.base] : [])];
  for (const chain of chains) {
    const balance = await client(rpcUrl(chain)).getBalance({ address: wallet.address });
    if (balance === 0n) {
      fail(
        `Deployer ${wallet.address} has 0 ${chain.nativeSymbol} on ${chain.name} (chain ${chain.id}). Fund it before deploying.`,
      );
    }
  }
  const updated = [];
  for (const chain of chains) {
    console.log(`Deploying ${chain.contract} on ${chain.name}...`);
    updated.push(await entry(chain, await deploy(chain, wallet.address, key), source));
  }
  const existing =
    mergeOnly && existsSync(RECORD_PATH) ? JSON.parse(readFileSync(RECORD_PATH, 'utf8')) : [];
  await publish(mergeOnly ? mergeRecord(existing, updated) : updated, source);
}

async function recordOnly() {
  const source = revision();
  const automationOnly =
    process.argv.includes('--lasna-only') || process.argv.includes('--reactive-only');
  const baseOnly = process.argv.includes('--base-only');
  if (automationOnly && baseOnly) {
    fail('Pass at most one of --lasna-only, --reactive-only, or --base-only.');
  }
  const mergeOnly = automationOnly || baseOnly;
  const includeBase =
    !process.argv.includes('--no-base') &&
    (baseOnly || process.argv.includes('--base') || existsSync(broadcastPath(CHAINS.base.id)));
  const chains = automationOnly
    ? [CHAINS[AUTOMATION_KEY]]
    : baseOnly
      ? [CHAINS.base]
      : [CHAINS[AUTOMATION_KEY], CHAINS.unichain, ...(includeBase ? [CHAINS.base] : [])];
  const updated = [];
  for (const chain of chains) {
    updated.push(await entry(chain, readBroadcast(chain.id), source));
  }
  const existing =
    mergeOnly && existsSync(RECORD_PATH) ? JSON.parse(readFileSync(RECORD_PATH, 'utf8')) : [];
  await publish(mergeOnly ? mergeRecord(existing, updated) : updated, source);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const entry = resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
}

if (isMainModule()) {
  try {
    if (process.argv.includes('--check')) await verify();
    else if (process.argv.includes('--record-only')) await recordOnly();
    else await release();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Workflow V2 release failed.');
    process.exitCode = 1;
  }
}
