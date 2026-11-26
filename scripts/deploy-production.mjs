import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_TESTNET_RECORD = new URL('../deployments/workflows-v2.json', import.meta.url);
export const DEFAULT_MAINNET_RECORD = new URL(
  '../deployments/workflows-v2-mainnet.json',
  import.meta.url,
);

export const FRONTEND_RPC_OVERRIDES = [
  ['VITE_LASNA_RPC_URL', 'LASNA_RPC_URL'],
  ['VITE_UNICHAIN_RPC_URL', 'UNICHAIN_RPC_URL'],
  ['VITE_BASE_SEPOLIA_RPC_URL', 'BASE_SEPOLIA_RPC_URL'],
  ['VITE_REACTIVE_MAINNET_RPC_URL', 'REACTIVE_MAINNET_RPC_URL'],
  ['VITE_UNICHAIN_MAINNET_RPC_URL', 'UNICHAIN_MAINNET_RPC_URL'],
  ['VITE_BASE_MAINNET_RPC_URL', 'BASE_MAINNET_RPC_URL'],
  ['VITE_UNICHAIN_WALLET_RPC_URL'],
  ['VITE_BASE_SEPOLIA_WALLET_RPC_URL'],
  ['VITE_REACTIVE_MAINNET_WALLET_RPC_URL'],
  ['VITE_UNICHAIN_MAINNET_WALLET_RPC_URL'],
  ['VITE_BASE_MAINNET_WALLET_RPC_URL'],
];

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing production configuration: ' + name);
  return value;
}

function origin(name) {
  const url = new URL(env(name));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(name + ' must be a public HTTPS origin.');
  }
  return url.origin;
}

function httpsUrl(name, raw) {
  if (/[\r\n]/.test(raw)) {
    throw new Error(name + ' must be a single-line HTTPS URL.');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(name + ' must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(name + ' must be a public HTTPS URL without embedded credentials.');
  }
  return url.toString();
}

function sources() {
  const repository = env('GITHUB_REPOSITORY');
  const revision = env('RELEASE_SHA');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('Invalid repository or tested release commit.');
  }
  return { revision, archive: `https://codeload.github.com/${repository}/tar.gz/${revision}` };
}

function backends() {
  const name = env('HEROKU_APP_NAME');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Invalid HEROKU_APP_NAME.');
  return { endpoint: `https://api.heroku.com/apps/${name}`, apiKey: env('HEROKU_API_KEY') };
}

function validDeploymentEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry === 'object' &&
    typeof entry.address === 'string' &&
    /^0x[0-9a-f]{40}$/i.test(entry.address) &&
    !/^0x0{40}$/i.test(entry.address) &&
    Number.isSafeInteger(entry.blockNumber) &&
    entry.blockNumber > 0
  );
}

function parseDeploymentRecord(
  records,
  { automationKey, automationChainId, unichainChainId, baseChainId, baseLabel, fileLabel },
) {
  if (!Array.isArray(records)) {
    throw new Error(`Invalid deployment record in ${fileLabel}: expected an array.`);
  }
  function findUnique(contract, chainId) {
    const matches = records.filter(
      (item) => item?.contract === contract && item?.chainId === chainId,
    );
    if (matches.length > 1) {
      throw new Error(`Duplicate deployment record for ${contract} (${chainId}) in ${fileLabel}`);
    }
    return matches[0];
  }
  function deployment(contract, chainId) {
    const entry = findUnique(contract, chainId);
    if (!validDeploymentEntry(entry)) {
      throw new Error(`Invalid deployment record for ${contract} in ${fileLabel}`);
    }
    return entry;
  }
  const agentFactory = deployment('WorkflowAgentFactoryV2', automationChainId);
  const vaultFactory = deployment('WorkflowVaultFactoryV2', unichainChainId);
  const baseEntry = findUnique('WorkflowVaultFactoryV2', baseChainId);
  if (baseEntry && !validDeploymentEntry(baseEntry)) {
    throw new Error(
      `Invalid deployment record for ${baseLabel} WorkflowVaultFactoryV2 in ${fileLabel}`,
    );
  }
  return {
    automationAddress: agentFactory.address,
    serialized: JSON.stringify({
      [automationKey]: { factory: agentFactory.address, startBlock: agentFactory.blockNumber },
      unichain: { factory: vaultFactory.address, startBlock: vaultFactory.blockNumber },
      ...(baseEntry
        ? { base: { factory: baseEntry.address, startBlock: baseEntry.blockNumber } }
        : {}),
    }),
  };
}

export async function workflowSettings({
  testnetPath = DEFAULT_TESTNET_RECORD,
  mainnetPath = DEFAULT_MAINNET_RECORD,
} = {}) {
  const testnetRecords = JSON.parse(await readFile(testnetPath, 'utf8'));
  const testnet = parseDeploymentRecord(testnetRecords, {
    automationKey: 'lasna',
    automationChainId: 5318007,
    unichainChainId: 1301,
    baseChainId: 84532,
    baseLabel: 'Base Sepolia',
    fileLabel: 'deployments/workflows-v2.json',
  });

  let mainnetRaw;
  try {
    mainnetRaw = await readFile(mainnetPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { WORKFLOW_V2_DEPLOYMENT: testnet.serialized };
    }
    throw new Error(
      `Failed to read deployments/workflows-v2-mainnet.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let mainnetRecords;
  try {
    mainnetRecords = JSON.parse(mainnetRaw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in deployments/workflows-v2-mainnet.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const mainnet = parseDeploymentRecord(mainnetRecords, {
    automationKey: 'reactive',
    automationChainId: 1597,
    unichainChainId: 130,
    baseChainId: 8453,
    baseLabel: 'Base',
    fileLabel: 'deployments/workflows-v2-mainnet.json',
  });

  if (mainnet.automationAddress.toLowerCase() === testnet.automationAddress.toLowerCase()) {
    throw new Error('Reactive Mainnet WorkflowAgentFactoryV2 must not match Reactive Lasna.');
  }

  return {
    WORKFLOW_V2_DEPLOYMENT: testnet.serialized,
    WORKFLOW_V2_MAINNET_DEPLOYMENT: mainnet.serialized,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deploymentsEqual(actualRaw, expectedRaw) {
  if (typeof actualRaw !== 'string' || !actualRaw.trim()) return false;
  let actual;
  let expected;
  try {
    actual = JSON.parse(actualRaw);
    expected = JSON.parse(expectedRaw);
  } catch {
    return false;
  }
  if (!isPlainObject(actual) || !isPlainObject(expected)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  return expectedKeys.every((key) => {
    const a = actual[key];
    const b = expected[key];
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const aFields = Object.keys(a).sort();
    const bFields = Object.keys(b).sort();
    if (
      aFields.length !== bFields.length ||
      aFields.some((field, index) => field !== bFields[index])
    ) {
      return false;
    }
    return (
      typeof a.factory === 'string' &&
      typeof b.factory === 'string' &&
      a.factory.toLowerCase() === b.factory.toLowerCase() &&
      a.startBlock === b.startBlock
    );
  });
}

export function validateHerokuWorkflowConfig(config, settings) {
  if (!deploymentsEqual(config.WORKFLOW_V2_DEPLOYMENT, settings.WORKFLOW_V2_DEPLOYMENT)) {
    throw new Error(
      'Heroku setting WORKFLOW_V2_DEPLOYMENT must match deployments/workflows-v2.json.',
    );
  }
  if (settings.WORKFLOW_V2_MAINNET_DEPLOYMENT) {
    if (
      !deploymentsEqual(
        config.WORKFLOW_V2_MAINNET_DEPLOYMENT,
        settings.WORKFLOW_V2_MAINNET_DEPLOYMENT,
      )
    ) {
      throw new Error(
        'Heroku setting WORKFLOW_V2_MAINNET_DEPLOYMENT must match deployments/workflows-v2-mainnet.json.',
      );
    }
  } else if (config.WORKFLOW_V2_MAINNET_DEPLOYMENT?.trim()) {
    throw new Error(
      'Heroku setting WORKFLOW_V2_MAINNET_DEPLOYMENT is set, but deployments/workflows-v2-mainnet.json is missing. Commit the mainnet deployment record or unset WORKFLOW_V2_MAINNET_DEPLOYMENT on Heroku.',
    );
  }
}

export function buildFrontendEnvLines({ server, settings, envMap = process.env }) {
  const lines = [
    'VITE_API_BASE_URL=' + server,
    'VITE_WORKFLOW_V2_DEPLOYMENT=' + settings.WORKFLOW_V2_DEPLOYMENT,
    'VITE_WORKFLOW_V2_MAINNET_DEPLOYMENT=' + (settings.WORKFLOW_V2_MAINNET_DEPLOYMENT ?? ''),
  ];
  for (const [viteVar, fallbackVar] of FRONTEND_RPC_OVERRIDES) {
    const raw = envMap[viteVar]?.trim() || (fallbackVar ? envMap[fallbackVar]?.trim() : '');
    if (raw) {
      lines.push(`${viteVar}=${httpsUrl(viteVar, raw)}`);
    }
  }
  const activation = envMap.WORKFLOW_V2_ACTIVATION?.trim();
  if (activation) {
    if (activation !== 'true' && activation !== 'false') {
      throw new Error('WORKFLOW_V2_ACTIVATION must be "true" or "false" when set.');
    }
    lines.push('VITE_WORKFLOW_V2_ACTIVATION=' + activation);
  }
  return lines;
}

async function json(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

async function until(label, timeout, task) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await task();
    if (result) return result;
    await delay(7_000);
  }
  throw new Error('Timed out waiting for ' + label + '.');
}

const ZERO_ADDRESS = '0x' + '0'.repeat(40);

export function mergeVercelTelegramRewrites(vercel, server) {
  const telegramRewrites = [
    {
      source: '/v1/telegram/availability',
      destination: server + '/v1/telegram/availability',
    },
    {
      source: '/v1/accounts/:agent/telegram',
      destination: server + '/v1/accounts/:agent/telegram',
    },
    {
      source: '/v1/accounts/:agent/telegram/:path*',
      destination: server + '/v1/accounts/:agent/telegram/:path*',
    },
  ];
  const managedSources = new Set(telegramRewrites.map((entry) => entry.source));
  const existing = Array.isArray(vercel?.rewrites) ? vercel.rewrites : [];
  return {
    ...vercel,
    rewrites: [
      ...telegramRewrites,
      ...existing.filter((entry) => !managedSources.has(entry?.source)),
    ],
  };
}

export async function verifyApiReady({ api, web, hasMainnet = false, fetchImpl = fetch }) {
  try {
    const healthResponse = await fetchImpl(api + '/health', {
      signal: AbortSignal.timeout(20_000),
    });
    if (!healthResponse.ok) return false;
    const health = await healthResponse.json();
    if (health.status !== 'ok' || health.database?.reachable !== true) return false;

    const networks = hasMainnet ? ['testnet', 'mainnet'] : ['testnet'];
    for (const network of networks) {
      const query = network === 'mainnet' ? '?network=mainnet' : '';
      const response = await fetchImpl(api + '/v3/marketplace' + query, {
        headers: { Origin: web, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok || response.headers.get('access-control-allow-origin') !== web) return false;
      const page = await response.json();
      if (
        !Array.isArray(page.listings) ||
        (page.nextCursor !== null && typeof page.nextCursor !== 'string')
      ) {
        return false;
      }
      if (network === 'mainnet') {
        const healthCheck = await fetchImpl(
          `${api}/v3/health?owner=${ZERO_ADDRESS}&network=mainnet`,
          {
            headers: { Origin: web, Accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
          },
        );
        if (!healthCheck.ok) return false;
        const healthPayload = await healthCheck.json();
        if (!Array.isArray(healthPayload.workflows)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function verifyTelegramProxy({ web, hasMainnet = false, fetchImpl = fetch }) {
  const networks = hasMainnet ? ['testnet', 'mainnet'] : ['testnet'];
  for (const network of networks) {
    const query = network === 'mainnet' ? '&network=mainnet' : '';
    const availabilityResponse = await fetchImpl(
      `${web}/v1/telegram/availability?workflow=true${query}`,
      {
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!availabilityResponse.ok) {
      throw new Error(`HTTP ${availabilityResponse.status} from ${new URL(web).hostname}`);
    }
    const availability = await availabilityResponse.json();
    if (typeof availability.available !== 'boolean') {
      throw new Error(`The frontend does not proxy ${network} Telegram requests to the API.`);
    }
    if (availability.available) {
      const suffix = network === 'mainnet' ? '?network=mainnet' : '';
      const settings = `${web}/v1/accounts/${ZERO_ADDRESS}/telegram`;
      const anonymous = await fetchImpl(`${settings}${suffix}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      if (anonymous.status !== 401) {
        throw new Error(
          `The ${network} Telegram account proxy did not require wallet verification.`,
        );
      }
      // An anonymous request clears only the response cookie and leaves the database untouched.
      const response = await fetchImpl(`${settings}/session${suffix}`, {
        method: 'DELETE',
        headers: { Origin: web },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      const cookie = response.headers.get('set-cookie');
      if (
        !response.ok ||
        !cookie?.startsWith('__Secure-rulebook-telegram=;') ||
        !cookie.includes('Max-Age=0; HttpOnly; SameSite=Strict; Secure')
      ) {
        throw new Error(
          `The ${network} Telegram account proxy did not forward the browser session cookie.`,
        );
      }
    }
  }
}

async function apiReady(hasMainnet = false) {
  return verifyApiReady({
    api: origin('HEROKU_API_URL'),
    web: origin('PRODUCTION_WEB_URL'),
    hasMainnet,
  });
}

async function backend() {
  const { endpoint, apiKey } = backends();
  const { revision, archive } = sources();
  function heroku(path, body, method = body ? 'POST' : 'GET') {
    return json(endpoint + path, {
      method,
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.heroku+json; version=3',
        Authorization: 'Bearer ' + apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  const app = await heroku('');
  if (new URL(app.web_url).origin !== origin('HEROKU_API_URL')) {
    // A custom hostname is valid only when Heroku lists it for this app.
    const domains = await heroku('/domains');
    if (!domains.some((domain) => `https://${domain.hostname}` === origin('HEROKU_API_URL'))) {
      throw new Error('HEROKU_API_URL does not belong to the configured app.');
    }
  }
  const config = await heroku('/config-vars');
  const settings = await workflowSettings();
  const hasMainnet = Boolean(settings.WORKFLOW_V2_MAINNET_DEPLOYMENT);
  validateHerokuWorkflowConfig(config, settings);
  for (const name of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!config[name]?.trim()) throw new Error('Missing Heroku setting: ' + name);
  }
  if (config.INDEXER_ENABLED !== 'true')
    throw new Error('Enable the Heroku workflow indexer before deploying.');
  if (
    !config.CORS_ORIGINS?.split(',')
      .map((entry) => entry.trim())
      .includes(origin('PRODUCTION_WEB_URL'))
  ) {
    throw new Error('Add the production frontend origin to Heroku CORS_ORIGINS.');
  }
  if (config.TELEGRAM_APP_ORIGIN && config.TELEGRAM_APP_ORIGIN !== origin('PRODUCTION_WEB_URL')) {
    throw new Error('Heroku TELEGRAM_APP_ORIGIN must match the production frontend origin.');
  }
  const existingFormation = await heroku('/formation');
  const firstWebProcess = !existingFormation.some((process) => process.type === 'web');
  const build = await heroku('/builds', { source_blob: { url: archive, version: revision } });
  if (!build.id) throw new Error('Heroku did not return a build ID.');
  console.log('Heroku build ' + build.id + ' for ' + revision);
  const releaseId = await until('Heroku build and release', 20 * 60_000, async () => {
    const current = await heroku('/builds/' + build.id);
    if (current.status === 'failed')
      throw new Error('Heroku build failed. See build ' + build.id + ' in Heroku Activity.');
    return current.status === 'succeeded' && current.release?.id;
  });
  await until('Heroku release phase', 8 * 60_000, async () => {
    const release = await heroku('/releases/' + releaseId);
    if (release.status === 'failed')
      throw new Error('Heroku release failed. See release ' + releaseId + ' in Heroku Activity.');
    return release.status === 'succeeded';
  });
  let formation = await heroku('/formation');
  if (firstWebProcess && process.env.HEROKU_FIRST_WEB_DYNO === 'basic') {
    const web = formation.find((process) => process.type === 'web');
    if (web && web.quantity <= 1 && (web.size !== 'basic' || web.quantity !== 1)) {
      await heroku('/formation/web', { quantity: 1, size: 'basic' }, 'PATCH');
      formation = await heroku('/formation');
    }
  }
  if (!formation.some((process) => process.type === 'web' && process.quantity > 0)) {
    throw new Error('The Heroku app needs an enabled web dyno.');
  }
  await until('new Heroku web release', 4 * 60_000, async () => {
    const dynos = await heroku('/dynos');
    const web = dynos.filter((dyno) => dyno.type === 'web');
    return (
      web.length > 0 && web.every((dyno) => dyno.state === 'up' && dyno.release?.id === releaseId)
    );
  });
  await until('healthy API and Marketplace CORS', 3 * 60_000, () => apiReady(hasMainnet));
  console.log('Heroku release verified: ' + releaseId);
}

async function smoke() {
  const web = origin('PRODUCTION_WEB_URL');
  const settings = await workflowSettings();
  const hasMainnet = Boolean(settings.WORKFLOW_V2_MAINNET_DEPLOYMENT);
  await until('public Marketplace page and API', 3 * 60_000, async () => {
    try {
      const page = await fetch(web + '/marketplace', {
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      return (
        page.ok &&
        page.headers.get('content-type')?.includes('text/html') &&
        (await apiReady(hasMainnet))
      );
    } catch {
      return false;
    }
  });
  console.log('Verified public Marketplace and API.');
  await verifyTelegramProxy({ web, hasMainnet });
  console.log('Verified the Telegram API through the frontend origin.');
}

async function main() {
  switch (process.argv[2]) {
    case 'preflight':
      backends();
      sources();
      {
        const server = origin('HEROKU_API_URL');
        origin('PRODUCTION_WEB_URL');
        env('VERCEL_TOKEN');
        env('VERCEL_ORG_ID');
        env('VERCEL_PROJECT_ID');
        const settings = await workflowSettings();
        const vercelFile = new URL('../frontend/vercel.json', import.meta.url);
        const vercel = mergeVercelTelegramRewrites(
          JSON.parse(await readFile(vercelFile, 'utf8')),
          server,
        );
        await writeFile(vercelFile, JSON.stringify(vercel, null, 2) + '\n');
        await appendFile(
          env('GITHUB_ENV'),
          [...buildFrontendEnvLines({ server, settings }), ''].join('\n'),
        );
        break;
      }
    case 'backend':
      await backend();
      break;
    case 'smoke':
      await smoke();
      break;
    default:
      throw new Error('Choose preflight, backend, or smoke.');
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const entry = resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
}

if (isMainModule()) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Production release failed.');
    process.exitCode = 1;
  }
}
