#!/usr/bin/env node
/**
 * One-command Workflow V2 release.
 *
 * Deploys the Agent factory on Reactive Lasna and the Vault factory on Unichain Sepolia from
 * `DeployWorkflowsV2.s.sol`, writes `deployments/workflows-v2.json` from the broadcast receipts,
 * points the local backend and frontend environment files at the new pair, and updates the
 * Heroku `WORKFLOW_V2_DEPLOYMENT` config var.
 *
 * `--check` performs no deployment: it verifies that the record, the local environment files,
 * and Heroku agree and that both factories have code on chain. Use it in preflight and CI.
 * `--record-only` rebuilds the record from the existing Foundry broadcast receipts without
 * deploying, which recovers a lost record or one written by hand.
 *
 * Env: DEPLOYER_PRIVATE_KEY, LASNA_RPC_URL, UNICHAIN_RPC_URL, optional FORGE_PATH,
 * HEROKU_APP_NAME (or --heroku-app), and HEROKU_API_KEY (otherwise read from the Heroku CLI).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256 } from 'viem';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONTRACTS = join(ROOT, 'contracts');
const RECORD_PATH = join(ROOT, 'deployments', 'workflows-v2.json');
const SCRIPT = 'script/DeployWorkflowsV2.s.sol';
const FORGE = process.env.FORGE_PATH ?? 'forge';
const LASNA_FEE_CAP = 950_000_000_000_000_000n;
const GWEI = 1_000_000_000n;

const CHAINS = {
  lasna: {
    id: 5318007,
    contract: 'WorkflowAgentFactoryV2',
    name: 'Reactive Lasna',
    explorer: 'https://lasna.reactscan.net',
    rpcEnv: 'LASNA_RPC_URL',
  },
  unichain: {
    id: 1301,
    contract: 'WorkflowVaultFactoryV2',
    name: 'Unichain Sepolia',
    explorer: 'https://sepolia.uniscan.xyz',
    rpcEnv: 'UNICHAIN_RPC_URL',
  },
};

function fail(message) {
  throw new Error(message);
}

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Set ${name} before running the Workflow V2 release.`);
  return value;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function client(rpc) {
  return createPublicClient({ transport: http(rpc, { timeout: 30_000 }) });
}

function forge(args) {
  return execFileSync(FORGE, args, {
    cwd: CONTRACTS,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function deploymentValue(record) {
  const lasna = record.find(
    (entry) => entry.contract === CHAINS.lasna.contract && entry.chainId === CHAINS.lasna.id,
  );
  const unichain = record.find(
    (entry) => entry.contract === CHAINS.unichain.contract && entry.chainId === CHAINS.unichain.id,
  );
  if (!lasna || !unichain) fail('deployments/workflows-v2.json is missing the factory pair.');
  return JSON.stringify({
    lasna: { factory: lasna.address, startBlock: lasna.blockNumber },
    unichain: { factory: unichain.address, startBlock: unichain.blockNumber },
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

async function deploy(chain, account) {
  const rpc = env(chain.rpcEnv);
  const publicClient = client(rpc);
  const args = ['script', SCRIPT, '--rpc-url', rpc];
  if (chain === CHAINS.lasna) {
    const simulation = forge(args);
    const gas = simulation.match(/Estimated total gas used for script:\s*(\d+)/)?.[1];
    if (!gas) fail('Could not read the Lasna gas estimate from the dry run.');
    const suggested = await publicClient.getGasPrice();
    const balance = await publicClient.getBalance({ address: account });
    const ceiling = LASNA_FEE_CAP / BigInt(gas);
    const price = ((suggested * 2n < ceiling ? suggested * 2n : ceiling) / GWEI) * GWEI;
    if (price <= suggested) {
      fail(
        `Lasna fees leave no headroom for ${gas} gas: suggested ${suggested} wei, ceiling ${ceiling} wei.`,
      );
    }
    if (balance < price * BigInt(gas)) {
      fail(`The deployer needs more lREACT on Lasna: balance ${balance} wei.`);
    }
    args.push('--legacy', '--with-gas-price', `${price / GWEI}gwei`);
  }
  forge([...args, '--broadcast', '--start-fresh']);
  return readBroadcast(chain.id);
}

function readBroadcast(chainId) {
  const path = join(
    CONTRACTS,
    'broadcast',
    'DeployWorkflowsV2.s.sol',
    String(chainId),
    'run-latest.json',
  );
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
  const rpc = env(chain.rpcEnv);
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

async function verify() {
  const record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
  const expected = deploymentValue(record);
  const problems = [];
  for (const chain of Object.values(CHAINS)) {
    const item = record.find((row) => row.contract === chain.contract && row.chainId === chain.id);
    if (!item) {
      problems.push(`missing ${chain.contract} record`);
      continue;
    }
    const code = await client(env(chain.rpcEnv)).getCode({ address: item.address });
    if (!code || code === '0x') problems.push(`${chain.contract} has no code at ${item.address}`);
  }
  for (const [file, key] of [
    [join(ROOT, 'backend', '.env'), 'WORKFLOW_V2_DEPLOYMENT'],
    [join(ROOT, 'frontend', '.env.local'), 'VITE_WORKFLOW_V2_DEPLOYMENT'],
  ]) {
    if (!existsSync(file)) continue;
    const value = readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];
    if (value?.trim().toLowerCase() !== expected.toLowerCase()) {
      problems.push(`${key} in ${file} does not match the record`);
    }
  }
  const herokuState = await heroku();
  if (herokuState.app) {
    if (herokuState.config.WORKFLOW_V2_DEPLOYMENT?.toLowerCase() !== expected.toLowerCase()) {
      problems.push(
        `Heroku WORKFLOW_V2_DEPLOYMENT on ${herokuState.app} does not match the record`,
      );
    }
  }
  if (problems.length) fail(problems.join('\n'));
  console.log(
    `Record is consistent with the local environment${herokuState.app ? ` and ${herokuState.app}` : ''}.`,
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
    [join(ROOT, 'backend', '.env'), 'WORKFLOW_V2_DEPLOYMENT'],
    [join(ROOT, 'frontend', '.env.local'), 'VITE_WORKFLOW_V2_DEPLOYMENT'],
  ]) {
    if (setEnvLine(file, name, value)) files.push(file);
  }
  // The backend dev watcher reloads its environment when the deployment record changes.
  if (serialized !== current || files.length) writeFileSync(RECORD_PATH, serialized);
  const herokuState = await heroku();
  const app = herokuState.app;
  if (app && herokuState.config.WORKFLOW_V2_DEPLOYMENT?.toLowerCase() !== value.toLowerCase()) {
    await heroku({ method: 'PATCH', body: JSON.stringify({ WORKFLOW_V2_DEPLOYMENT: value }) });
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
  console.log(`WORKFLOW_V2_DEPLOYMENT=${value}`);
}

async function release() {
  const key = process.env.DEPLOYER_PRIVATE_KEY?.trim() ?? process.env.SPONSOR_PRIVATE_KEY?.trim();
  if (!key) fail('Set DEPLOYER_PRIVATE_KEY (or SPONSOR_PRIVATE_KEY) before deploying.');
  const wallet = (await import('viem/accounts')).privateKeyToAccount(
    key.startsWith('0x') ? key : `0x${key}`,
  );
  const source = revision();
  const record = [];
  for (const chain of Object.values(CHAINS)) {
    console.log(`Deploying ${chain.contract} on ${chain.name}...`);
    record.push(await entry(chain, await deploy(chain, wallet.address), source));
  }
  await publish(record, source);
}

async function recordOnly() {
  const source = revision();
  const record = [];
  for (const chain of Object.values(CHAINS)) {
    record.push(await entry(chain, readBroadcast(chain.id), source));
  }
  await publish(record, source);
}

try {
  if (process.argv.includes('--check')) await verify();
  else if (process.argv.includes('--record-only')) await recordOnly();
  else await release();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Workflow V2 release failed.');
  process.exitCode = 1;
}
