#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const forge = process.env.FORGE_PATH ?? 'forge';

const steps = [
  ['format', npm, ['run', 'format:check']],
  ['contracts:format', forge, ['fmt', '--check'], 'contracts'],
  ['contracts:build', forge, ['build'], 'contracts'],
  ['contracts:test', forge, ['test', '--deny', 'warnings'], 'contracts'],
  ['contracts:snapshot', forge, ['snapshot', '--check'], 'contracts'],
  ['contracts:coverage', process.execPath, ['scripts/coverage-gate.mjs']],
  ['build', npm, ['run', 'build']],
  ['typecheck', npm, ['run', 'typecheck']],
  ['test', npm, ['run', 'test']],
  ['lint', npm, ['run', 'lint']],
  ['secret-scan', process.execPath, ['scripts/secret-scan.mjs']],
];

for (const [name, command, args, cwd] of steps) {
  console.log(`RUN   ${name}`);
  const windowsNpm = process.platform === 'win32' && command === npm;
  // npm.cmd needs cmd.exe on Windows. Its command and arguments above are fixed literals.
  const result = windowsNpm
    ? spawnSync([command, ...args].join(' '), { cwd, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`FAIL  ${name} (${result.error?.message ?? `exit ${result.status}`})`);
    process.exit(result.status || 1);
  }
}

console.log('All gates passed.');
