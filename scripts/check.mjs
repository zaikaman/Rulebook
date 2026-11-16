#!/usr/bin/env node
/**
 * The single local gate. Runs every check the constitution requires, in the order that
 * fails fastest, and exits non-zero on the first failure.
 *
 * Steps whose toolchain is not installed are reported as SKIPPED rather than silently
 * passing, so a green run never implies more than it checked.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const steps = [
  { name: 'prettier', cmd: 'npx', args: ['prettier', '--check', '.'] },
  { name: 'shared:build', cmd: 'npm', args: ['run', 'build', '-w', 'packages/shared'] },
  { name: 'contracts:fmt', cmd: 'forge', args: ['fmt', '--check'], cwd: 'contracts' },
  { name: 'contracts:build', cmd: 'forge', args: ['build'], cwd: 'contracts' },
  { name: 'contracts:test', cmd: 'forge', args: ['test'], cwd: 'contracts' },
  {
    name: 'contracts:coverage',
    cmd: 'forge',
    args: ['coverage', '--report', 'summary'],
    cwd: 'contracts',
  },
  { name: 'coverage-gate', cmd: 'node', args: ['scripts/coverage-gate.mjs'], optional: true },
  { name: 'backend:typecheck', cmd: 'npm', args: ['run', 'typecheck', '-w', 'backend'] },
  { name: 'backend:test', cmd: 'npm', args: ['run', 'test', '-w', 'backend'] },
  { name: 'frontend:typecheck', cmd: 'npm', args: ['run', 'typecheck', '-w', 'frontend'] },
  { name: 'frontend:test', cmd: 'npm', args: ['run', 'test', '-w', 'frontend'] },
  { name: 'frontend:build', cmd: 'npm', args: ['run', 'build', '-w', 'frontend'] },
  { name: 'lint', cmd: 'npm', args: ['run', 'lint'] },
  { name: 'secret-scan', cmd: 'node', args: ['scripts/secret-scan.mjs'], optional: true },
];

function hasCommand(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, [cmd], { stdio: 'ignore', shell: false });
  return result.status === 0;
}

/** Phase 1 ships no Solidity yet; the contracts gates start meaning something in Phase 2. */
function hasSolidity() {
  try {
    return readdirSync('contracts/src', { recursive: true }).some((entry) =>
      String(entry).endsWith('.sol'),
    );
  } catch {
    return false;
  }
}

const foundryAvailable = hasCommand('forge') || existsSync('.tools/foundry/forge.exe');
const solidityPresent = hasSolidity();

let skipped = [];

for (const step of steps) {
  if (step.optional && !existsSync(step.args[0])) {
    skipped.push(step.name);
    console.log(`SKIP  ${step.name}  (script not present yet)`);
    continue;
  }
  if (step.cmd === 'forge' && (!foundryAvailable || !solidityPresent)) {
    skipped.push(step.name);
    console.log(
      `SKIP  ${step.name}  (${foundryAvailable ? 'no Solidity sources yet' : 'foundry not installed'})`,
    );
    continue;
  }
  console.log(`RUN   ${step.name}`);
  // Args are joined into one command line because Node deprecates
  // `spawn(cmd, args, { shell: true })`. Every argument here is a literal path or flag
  // with no spaces, so joining is safe.
  const commandLine = [step.cmd, ...step.args].join(' ');
  const result = spawnSync(commandLine, {
    cwd: step.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`\nFAIL  ${step.name} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll gates passed${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}.`);
if (skipped.length) {
  console.log('Skipped steps are unverified, not passing.');
}
