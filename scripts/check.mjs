#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { absoluteGitDir, computeChangeSet } from './change-set.mjs';
import { resolveFoundryBinary } from './foundry-env.mjs';
import {
  createRepoSnapshot,
  getForgeVersionKey,
  loadGateCache,
  matchesBrowser,
  matchesBuildBackend,
  matchesBuildFrontend,
  matchesBuildShared,
  matchesContracts,
  matchesContractsCoverage,
  matchesGeneratedArtifacts,
  matchesTestBackend,
  matchesTestFrontend,
  matchesTestShared,
  saveGateCache,
} from './verify-cache.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const workspaceResolvePaths = [
  ROOT,
  join(ROOT, 'frontend'),
  join(ROOT, 'backend'),
  join(ROOT, 'packages/shared'),
];

function resolveBin(pkg, binName) {
  const pkgPath = require.resolve(`${pkg}/package.json`, { paths: workspaceResolvePaths });
  const meta = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const rel = typeof meta.bin === 'string' ? meta.bin : meta.bin[binName];
  if (!rel) throw new Error(`Binary "${binName}" not found in ${pkgPath}`);
  return resolve(dirname(pkgPath), rel);
}

const eslintBin = resolveBin('eslint', 'eslint');
const prettierBin = resolveBin('prettier', 'prettier');
const tscBin = resolveBin('typescript', 'tsc');
const vitestBin = resolveBin('vitest', 'vitest');
const viteBin = resolveBin('vite', 'vite');
const playwrightBin = resolveBin('@playwright/test', 'playwright');
const forge = resolveFoundryBinary('forge', process.env.FORGE_PATH);

const args = process.argv.slice(2);
const fast = args.includes('--fast') && !args.includes('--full');
const useCache = !args.includes('--no-cache') && !process.env.CI;
const e2eTargets = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--e2e' && args[index + 1]) {
    e2eTargets.push(...args[index + 1].split(',').filter(Boolean));
  }
}

const startedAll = Date.now();
const active = new Set();
let failed = false;
let exitCode = 1;

function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Child trees on Windows (e.g. Playwright/Anvil/Vite) need taskkill /T.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function spawnTask({ id, command, taskArgs, cwd, env }) {
  const started = Date.now();
  console.log(`RUN   ${id}`);
  return new Promise((resolvePromise) => {
    const child = spawn(command, taskArgs, {
      cwd: cwd ? join(ROOT, cwd) : ROOT,
      stdio: 'inherit',
      env: env ? { ...process.env, ...env } : process.env,
    });
    active.add(child);

    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      active.delete(child);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`OK    ${id} (${seconds}s)`);
        resolvePromise(true);
        return;
      }
      console.error(`FAIL  ${id} (${seconds}s)`);
      if (!failed) {
        failed = true;
        exitCode = code || 1;
        for (const other of active) terminate(other);
      }
      resolvePromise(false);
    };

    child.on('error', (error) => {
      console.error(error.message);
      finish(1);
    });
    // `close` fires once stdio has flushed, unlike `exit`.
    child.on('close', (code) => finish(code ?? 1));
  });
}

const gitDir = useCache ? absoluteGitDir({ cwd: ROOT }) : null;
const gateCache = useCache ? loadGateCache(gitDir) : { schemaVersion: 1, gates: {} };
const snapshot = useCache ? createRepoSnapshot(ROOT) : null;
const forgeVersion = useCache ? getForgeVersionKey(forge) : '';
const nodeVersion = process.version;

function keyFor(predicate, extraStrings) {
  return snapshot ? snapshot.hashSubset(predicate, extraStrings) : undefined;
}

function isCacheHit(task) {
  if (!useCache || !task.cacheKey) return false;
  if (gateCache.gates[task.id] !== task.cacheKey) return false;
  return (task.verifyOutputs ?? []).every((rel) => existsSync(join(ROOT, rel)));
}

async function runDag(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const completed = new Set();
  const started = new Set();

  return new Promise((resolvePromise) => {
    const scheduleReady = () => {
      if (failed) {
        if (active.size === 0) resolvePromise();
        return;
      }

      let progressed = true;
      while (progressed && !failed) {
        progressed = false;
        for (const task of tasks) {
          if (started.has(task.id)) continue;
          const depsDone = task.deps.every((dep) => {
            if (!byId.has(dep)) return true;
            return completed.has(dep);
          });
          if (!depsDone) continue;

          started.add(task.id);
          if (isCacheHit(task)) {
            console.log(`CACHED ${task.id}`);
            completed.add(task.id);
            progressed = true;
            continue;
          }

          void spawnTask(task).then((ok) => {
            if (ok) {
              completed.add(task.id);
              if (useCache && task.cacheKey) {
                gateCache.gates[task.id] = task.cacheKey;
                saveGateCache(gitDir, gateCache);
              }
            }
            scheduleReady();
          });
        }
      }

      if (completed.size === tasks.length || (failed && active.size === 0)) {
        resolvePromise();
      }
    };

    scheduleReady();
  });
}

const node = process.execPath;

const staticTasks = [
  {
    id: 'format',
    deps: [],
    command: node,
    taskArgs: [
      prettierBin,
      '--check',
      ...(useCache
        ? [
            '--cache',
            '--cache-location',
            'node_modules/.cache/prettier/.prettiercache',
            '--cache-strategy',
            'content',
          ]
        : []),
      '.',
    ],
  },
  {
    id: 'design',
    deps: [],
    command: node,
    taskArgs: ['scripts/design-check.mjs'],
  },
  {
    id: 'lint',
    deps: ['generated-artifacts'],
    command: node,
    taskArgs: [
      eslintBin,
      '.',
      ...(useCache
        ? [
            '--cache',
            '--cache-location',
            'node_modules/.cache/eslint/.eslintcache',
            '--cache-strategy',
            'content',
          ]
        : []),
      '--max-warnings',
      '0',
    ],
  },
  {
    id: 'secret-scan',
    deps: [],
    command: node,
    taskArgs: ['scripts/secret-scan.mjs'],
  },
];

const contractBuildOutputs = [
  'contracts/out/WorkflowAgentFactoryV2.sol/WorkflowAgentFactoryV2.json',
  'contracts/out/WorkflowVaultFactoryV2.sol/WorkflowVaultFactoryV2.json',
  'contracts/out/MockERC20.sol/MockERC20.json',
  'contracts/out/MockSystemContract.sol/MockSystemContract.json',
  'contracts/cache/solidity-files-cache.json',
];

const buildContractTasks = (includeCoverage) => [
  {
    id: 'contracts:format',
    deps: [],
    command: forge,
    taskArgs: ['fmt', '--check'],
    cwd: 'contracts',
    cacheKey: keyFor(matchesContracts, [forgeVersion, 'contracts:format']),
  },
  {
    id: 'contracts:build',
    deps: [],
    command: forge,
    taskArgs: ['build', '--sizes', '--no-lint', '--deny', 'warnings'],
    cwd: 'contracts',
    cacheKey: keyFor(matchesContracts, [forgeVersion, 'contracts:build']),
    verifyOutputs: contractBuildOutputs,
  },
  {
    id: 'contracts:test',
    deps: ['contracts:build'],
    command: forge,
    taskArgs: ['test'],
    cwd: 'contracts',
    cacheKey: keyFor(matchesContracts, [forgeVersion, 'contracts:test']),
  },
  {
    id: 'contracts:snapshot',
    deps: ['contracts:test'],
    command: forge,
    taskArgs: ['snapshot', '--check', '--no-match-test', 'testFuzz'],
    cwd: 'contracts',
    cacheKey: keyFor(matchesContracts, [forgeVersion, 'contracts:snapshot']),
  },
  ...(includeCoverage
    ? [
        {
          id: 'contracts:coverage',
          deps: ['contracts:snapshot'],
          command: node,
          taskArgs: ['scripts/coverage-gate.mjs'],
          cacheKey: keyFor(matchesContractsCoverage, [
            forgeVersion,
            nodeVersion,
            'contracts:coverage',
          ]),
        },
      ]
    : []),
];

const generatedArtifactsTask = {
  id: 'generated-artifacts',
  deps: ['contracts:build'],
  command: node,
  taskArgs: ['scripts/generate-check.mjs'],
  cacheKey: keyFor(matchesGeneratedArtifacts, [forgeVersion, nodeVersion, 'generated-artifacts']),
};

const sharedBuildOutputs = ['packages/shared/dist/index.js', 'packages/shared/dist/index.d.ts'];

const buildSharedTask = {
  id: 'build:shared',
  deps: ['generated-artifacts'],
  command: node,
  taskArgs: [tscBin, '--build', 'tsconfig.json'],
  cwd: 'packages/shared',
  cacheKey: keyFor(matchesBuildShared, [nodeVersion, 'build:shared']),
  verifyOutputs: sharedBuildOutputs,
};

const nodeBuildAndTestTasks = [
  buildSharedTask,
  {
    id: 'build:backend',
    deps: ['build:shared'],
    command: node,
    taskArgs: [tscBin, '-p', 'tsconfig.json'],
    cwd: 'backend',
    cacheKey: keyFor(matchesBuildBackend, [nodeVersion, 'build:backend']),
    verifyOutputs: ['backend/dist/server.js'],
  },
  {
    id: 'build:frontend:types',
    deps: ['build:shared'],
    command: node,
    taskArgs: [tscBin, '-p', 'tsconfig.json', '--noEmit'],
    cwd: 'frontend',
    cacheKey: keyFor(matchesBuildFrontend, [nodeVersion, 'build:frontend:types']),
  },
  {
    id: 'build:frontend:bundle',
    deps: ['build:shared'],
    command: node,
    taskArgs: [viteBin, 'build'],
    cwd: 'frontend',
    cacheKey: keyFor(matchesBuildFrontend, [nodeVersion, 'build:frontend:bundle']),
    verifyOutputs: ['frontend/dist/index.html'],
  },
  {
    id: 'test:shared',
    deps: ['build:shared'],
    command: node,
    taskArgs: [vitestBin, 'run', '--passWithNoTests'],
    cwd: 'packages/shared',
    cacheKey: keyFor(matchesTestShared, [nodeVersion, 'test:shared']),
  },
  {
    id: 'test:backend',
    deps: ['build:shared'],
    command: node,
    taskArgs: [vitestBin, 'run', '--passWithNoTests'],
    cwd: 'backend',
    cacheKey: keyFor(matchesTestBackend, [nodeVersion, 'test:backend']),
  },
  {
    id: 'test:frontend',
    deps: ['build:shared'],
    command: node,
    taskArgs: [vitestBin, 'run', '--passWithNoTests'],
    cwd: 'frontend',
    cacheKey: keyFor(matchesTestFrontend, [nodeVersion, 'test:frontend']),
  },
];

const browserEnvKey = [
  process.env.RULEBOOK_E2E_MOBILE ?? '',
  process.env.RULEBOOK_E2E_LIVE_APP ?? '',
  process.env.RULEBOOK_E2E_RPC_PORT ?? '',
  process.env.RULEBOOK_E2E_BASE_RPC_PORT ?? '',
  process.env.RULEBOOK_E2E_API_PORT ?? '',
  process.env.RULEBOOK_E2E_FRONTEND_PORT ?? '',
  process.env.ANVIL_PATH ?? '',
];

const tasks = [...staticTasks];

if (!fast) {
  tasks.push(...buildContractTasks(true), generatedArtifactsTask, ...nodeBuildAndTestTasks, {
    id: 'browser',
    deps: [
      'contracts:build',
      'build:shared',
      'generated-artifacts',
      'build:frontend:types',
      'build:frontend:bundle',
      'test:shared',
      'test:backend',
      'test:frontend',
    ],
    command: node,
    taskArgs: [playwrightBin, 'test'],
    cacheKey: keyFor(matchesBrowser, [forgeVersion, nodeVersion, 'browser', ...browserEnvKey]),
  });
} else {
  const { files } = computeChangeSet();
  const isDocOrMetaOnly = (file) =>
    file.endsWith('.md') ||
    file.startsWith('docs/') ||
    file === '.gitignore' ||
    file === '.prettierignore';
  const touchesContracts = files.some(
    (file) =>
      file.startsWith('contracts/') ||
      file.startsWith('packages/shared/src/abi/') ||
      file === 'packages/shared/scripts/copy-abis.ts' ||
      file === 'scripts/coverage-gate.mjs' ||
      file === 'scripts/generate-check.mjs' ||
      file === 'scripts/foundry-env.mjs',
  );
  const touchesCode = files.some((file) => !isDocOrMetaOnly(file));
  const changedE2eSpecs = files.filter(
    (file) => file.startsWith('frontend/e2e/') && file.endsWith('.spec.ts'),
  );
  const selectedSpecs = [...new Set([...changedE2eSpecs, ...e2eTargets])];

  if (touchesContracts) {
    tasks.push(...buildContractTasks(false), generatedArtifactsTask);
  } else {
    console.log('SKIP  contracts (--fast: no contract changes)');
  }

  if (touchesCode) {
    tasks.push(...nodeBuildAndTestTasks);
  } else {
    console.log('SKIP  build & test (--fast: docs/metadata changes only)');
  }

  if (selectedSpecs.length > 0) {
    const needsContractBuild =
      !touchesContracts && !contractBuildOutputs.every((rel) => existsSync(join(ROOT, rel)));
    if (needsContractBuild) {
      tasks.push({
        id: 'contracts:build',
        deps: [],
        command: forge,
        taskArgs: ['build', '--sizes', '--no-lint', '--deny', 'warnings'],
        cwd: 'contracts',
        cacheKey: keyFor(matchesContracts, [forgeVersion, 'contracts:build']),
        verifyOutputs: contractBuildOutputs,
      });
    }
    const needsSharedBuild =
      !touchesCode && !sharedBuildOutputs.every((rel) => existsSync(join(ROOT, rel)));
    if (needsSharedBuild) {
      tasks.push(buildSharedTask);
    }
    const deps = [];
    if (touchesCode || needsSharedBuild) deps.push('build:shared');
    if (touchesCode) {
      deps.push(
        'build:frontend:types',
        'build:frontend:bundle',
        'test:shared',
        'test:backend',
        'test:frontend',
      );
    }
    if (touchesContracts || needsContractBuild) deps.push('contracts:build');
    if (touchesContracts) deps.push('generated-artifacts');
    tasks.push({
      id: 'browser:targeted',
      deps,
      command: node,
      taskArgs: [playwrightBin, 'test', ...selectedSpecs],
      cacheKey: keyFor(matchesBrowser, [
        forgeVersion,
        nodeVersion,
        'browser:targeted',
        selectedSpecs.slice().sort().join(','),
        ...browserEnvKey,
      ]),
    });
  } else {
    console.log(
      'SKIP  browser (--fast: run `npm run verify` before push or `npx playwright test <spec>` for UI changes)',
    );
  }
}

await runDag(tasks);
if (failed) process.exit(exitCode);

if (!process.env.CI && e2eTargets.length === 0) {
  const { state, hasChanges } = computeChangeSet({ cwd: ROOT });
  if (hasChanges) {
    const dir = gitDir ?? absoluteGitDir({ cwd: ROOT });
    const stampName = fast ? 'verify-fast-stamp' : 'verify-stamp';
    writeFileSync(join(dir, stampName), `${state}\n`);
  }
}

const totalSeconds = ((Date.now() - startedAll) / 1000).toFixed(1);
console.log(`All gates passed (${totalSeconds}s).`);
