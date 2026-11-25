#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';

import { computeChangeSet } from './change-set.mjs';
import { resolveFoundryBinary } from './foundry-env.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const forge = resolveFoundryBinary('forge', process.env.FORGE_PATH);

const args = process.argv.slice(2);
const fast = args.includes('--fast') && !args.includes('--full');
const e2eTargets = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--e2e' && args[index + 1]) {
    e2eTargets.push(...args[index + 1].split(',').filter(Boolean));
  }
}

const step = (name, command, stepArgs, cwd) => ({ name, command, args: stepArgs, cwd });

// npm.cmd and npx.cmd need cmd.exe on Windows. Commands and arguments above are fixed literals
// or validated spec paths.
const usesShell = (command) => process.platform === 'win32' && (command === npm || command === npx);

const active = new Set();
let failed = false;
let exitCode = 1;

function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // npm and forge spawn grandchildren; taskkill /T takes the whole tree down.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function runStep({ name, command, args, cwd }) {
  const started = Date.now();
  console.log(`RUN   ${name}`);
  return new Promise((resolve) => {
    const child = usesShell(command)
      ? spawn([command, ...args].join(' '), { cwd, stdio: 'inherit', shell: true })
      : spawn(command, args, { cwd, stdio: 'inherit' });
    active.add(child);

    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      active.delete(child);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`OK    ${name} (${seconds}s)`);
        resolve(true);
        return;
      }
      console.error(`FAIL  ${name} (${seconds}s)`);
      if (!failed) {
        failed = true;
        exitCode = code || 1;
        for (const other of active) terminate(other);
      }
      resolve(false);
    };

    child.on('error', (error) => {
      console.error(error.message);
      finish(1);
    });
    // `close` fires once stdio has flushed, unlike `exit`.
    child.on('close', (code) => finish(code ?? 1));
  });
}

async function runTrack(track) {
  for (const entry of track) {
    if (failed) return;
    const ok = await runStep(entry);
    if (!ok) return;
  }
}

async function runStage(label, tracks) {
  console.log(`\n== ${label} ==`);
  await Promise.all(tracks.map(runTrack));
  if (failed) process.exit(exitCode);
}

const staticGates = [
  step('format', npm, ['run', 'format:check']),
  step('design', process.execPath, ['scripts/design-check.mjs']),
  step('lint', npm, ['run', 'lint']),
  step('secret-scan', process.execPath, ['scripts/secret-scan.mjs']),
];

// `npm run build` and `npm run test` typecheck every TypeScript project, so no separate
// typecheck gate is needed here.
const contracts = [
  step('contracts:format', forge, ['fmt', '--check'], 'contracts'),
  step('contracts:build', forge, ['build', '--sizes'], 'contracts'),
  step('contracts:test', forge, ['test', '--deny', 'warnings'], 'contracts'),
  // Fuzz tests average gas over random inputs, so their snapshot row is not reproducible.
  step(
    'contracts:snapshot',
    forge,
    ['snapshot', '--check', '--no-match-test', 'testFuzz'],
    'contracts',
  ),
  ...(fast ? [] : [step('contracts:coverage', process.execPath, ['scripts/coverage-gate.mjs'])]),
];

await runStage(
  'static gates',
  staticGates.map((gate) => [gate]),
);

if (!fast) {
  await runStage('contracts and node gates', [
    contracts,
    [step('build', npm, ['run', 'build']), step('test', npm, ['run', 'test'])],
  ]);
  // Mirrors the CI `browser and generated artifacts` job: the generated ABI module must match
  // contracts/out, and the Playwright flows run against the local chain.
  await runStage('browser and generated artifacts', [
    [
      step('generated-artifacts', process.execPath, ['scripts/generate-check.mjs']),
      step('browser', npm, ['run', 'test:e2e']),
    ],
  ]);
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
      file === 'scripts/coverage-gate.mjs',
  );
  const touchesCode = files.some((file) => !isDocOrMetaOnly(file));
  const changedE2eSpecs = files.filter(
    (file) => file.startsWith('frontend/e2e/') && file.endsWith('.spec.ts'),
  );
  const selectedSpecs = [...new Set([...changedE2eSpecs, ...e2eTargets])];

  const tracks = [];
  if (touchesContracts) {
    tracks.push(contracts);
  } else {
    console.log('\nSKIP  contracts (--fast: no contract changes)');
  }
  if (touchesCode) {
    tracks.push([step('build', npm, ['run', 'build']), step('test', npm, ['run', 'test'])]);
  } else {
    console.log('SKIP  build & test (--fast: docs/metadata changes only)');
  }
  if (tracks.length > 0) {
    await runStage('fast contracts and node gates', tracks);
  }

  const browserTracks = [];
  if (touchesContracts) {
    browserTracks.push(
      step('generated-artifacts', process.execPath, ['scripts/generate-check.mjs']),
    );
  }
  if (selectedSpecs.length > 0) {
    browserTracks.push(step('browser:targeted', npx, ['playwright', 'test', ...selectedSpecs]));
  } else {
    console.log(
      'SKIP  browser (--fast: run `npm run verify` before push or `npx playwright test <spec>` for UI changes)',
    );
  }
  if (browserTracks.length > 0) {
    await runStage('fast browser and generated artifacts', [browserTracks]);
  }
}

console.log('All gates passed.');
