#!/usr/bin/env node
/**
 * Fails when the committed ABI module does not match a fresh build of contracts/out.
 * CI and `npm run verify` both run this, so a contract change that was not regenerated
 * cannot merge or be pushed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const target = 'packages/shared/src/abi/index.ts';

const read = () => {
  try {
    return readFileSync(target, 'utf8');
  } catch {
    return null;
  }
};

const before = read();
// npm.cmd needs cmd.exe on Windows; the command and arguments are fixed literals.
const result = spawnSync(
  process.platform === 'win32' ? `${npm} run generate -w packages/shared` : npm,
  process.platform === 'win32' ? [] : ['run', 'generate', '-w', 'packages/shared'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (read() === before) {
  console.log(`${target} is up to date with contracts/out.`);
  process.exit(0);
}

console.error(
  `${target} was stale and has been regenerated. Review the generated diff and commit it.`,
);
process.exit(1);
