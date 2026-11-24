#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const forge = process.env.FORGE_PATH ?? 'forge';

const step = (name, command, args, cwd) => ({ name, command, args, cwd });

// npm.cmd needs cmd.exe on Windows. Its command and arguments above are fixed literals.
const usesShell = (command) => process.platform === 'win32' && command === npm;

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
  step('contracts:build', forge, ['build'], 'contracts'),
  step('contracts:test', forge, ['test', '--deny', 'warnings'], 'contracts'),
  step('contracts:snapshot', forge, ['snapshot', '--check'], 'contracts'),
  step('contracts:coverage', process.execPath, ['scripts/coverage-gate.mjs']),
];

await runStage(
  'static gates',
  staticGates.map((gate) => [gate]),
);
await runStage('contracts and node gates', [
  contracts,
  [step('build', npm, ['run', 'build']), step('test', npm, ['run', 'test'])],
]);

console.log('All gates passed.');
