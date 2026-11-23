import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

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

async function workflowSettings() {
  const records = JSON.parse(
    await readFile(new URL('../deployments/workflows-v2.json', import.meta.url), 'utf8'),
  );
  function deployment(contract, chainId) {
    const entry = records.find((item) => item.contract === contract && item.chainId === chainId);
    if (
      !entry ||
      !/^0x[0-9a-f]{40}$/i.test(entry.address) ||
      !Number.isSafeInteger(entry.blockNumber) ||
      entry.blockNumber <= 0
    ) {
      throw new Error('Invalid deployment record for ' + contract);
    }
    return entry;
  }
  const agentFactory = deployment('WorkflowAgentFactoryV2', 5318007);
  const vaultFactory = deployment('WorkflowVaultFactoryV2', 1301);
  return {
    WORKFLOW_V2_DEPLOYMENT: JSON.stringify({
      lasna: { factory: agentFactory.address, startBlock: agentFactory.blockNumber },
      unichain: { factory: vaultFactory.address, startBlock: vaultFactory.blockNumber },
    }),
  };
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

async function apiReady() {
  const api = origin('HEROKU_API_URL');
  const web = origin('PRODUCTION_WEB_URL');
  try {
    const health = await json(api + '/health');
    if (health.status !== 'ok' || health.database?.reachable !== true) return false;
    const response = await fetch(api + '/v3/marketplace', {
      headers: { Origin: web, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || response.headers.get('access-control-allow-origin') !== web) return false;
    const page = await response.json();
    return (
      Array.isArray(page.listings) &&
      (page.nextCursor === null || typeof page.nextCursor === 'string')
    );
  } catch {
    return false;
  }
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
  for (const [name, expected] of Object.entries(await workflowSettings())) {
    if (config[name]?.toLowerCase() !== expected.toLowerCase()) {
      throw new Error('Heroku setting ' + name + ' must match deployments/workflows-v2.json.');
    }
  }
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
  await until('healthy API and Marketplace CORS', 3 * 60_000, apiReady);
  console.log('Heroku release verified: ' + releaseId);
}

async function smoke() {
  const web = origin('PRODUCTION_WEB_URL');
  await until('public Marketplace page and API', 3 * 60_000, async () => {
    try {
      const page = await fetch(web + '/marketplace', {
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      return (
        page.ok && page.headers.get('content-type')?.includes('text/html') && (await apiReady())
      );
    } catch {
      return false;
    }
  });
  console.log('Verified public Marketplace and API.');
  const availability = await json(web + '/v1/telegram/availability?workflow=true');
  if (typeof availability.available !== 'boolean') {
    throw new Error('The frontend does not proxy Telegram requests to the API.');
  }
  if (availability.available) {
    const account = '0x' + '0'.repeat(40);
    const settings = `${web}/v1/accounts/${account}/telegram`;
    const anonymous = await fetch(settings, {
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    if (anonymous.status !== 401) {
      throw new Error('The Telegram account proxy did not require wallet verification.');
    }
    // An anonymous request clears only the response cookie and leaves the database untouched.
    const response = await fetch(settings + '/session', {
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
      throw new Error('The Telegram account proxy did not forward the browser session cookie.');
    }
  }
  console.log('Verified the Telegram API through the frontend origin.');
}

try {
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
        const vercel = JSON.parse(await readFile(vercelFile, 'utf8'));
        vercel.rewrites.unshift(
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
        );
        await writeFile(vercelFile, JSON.stringify(vercel, null, 2) + '\n');
        await appendFile(
          env('GITHUB_ENV'),
          [
            'VITE_API_BASE_URL=' + server,
            'VITE_WORKFLOW_V2_DEPLOYMENT=' + settings.WORKFLOW_V2_DEPLOYMENT,
            ...(process.env.WORKFLOW_V2_ACTIVATION
              ? ['VITE_WORKFLOW_V2_ACTIVATION=' + process.env.WORKFLOW_V2_ACTIVATION]
              : []),
            '',
          ].join('\n'),
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
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Production release failed.');
  process.exitCode = 1;
}
