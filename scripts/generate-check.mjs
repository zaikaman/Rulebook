#!/usr/bin/env node
/**
 * Fails when the committed ABI module does not match a fresh build of contracts/out.
 * CI and `npm run verify` both run this, so a contract change that was not regenerated
 * cannot merge or be pushed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const tsxPkgPath = require.resolve('tsx/package.json', {
  paths: [root, resolve(root, 'packages/shared'), resolve(root, 'backend')],
});
const tsxMeta = JSON.parse(readFileSync(tsxPkgPath, 'utf8'));
const tsxRel = typeof tsxMeta.bin === 'string' ? tsxMeta.bin : tsxMeta.bin.tsx;
const tsxBin = resolve(dirname(tsxPkgPath), tsxRel);

const target = 'packages/shared/src/abi/index.ts';

const read = () => {
  try {
    return readFileSync(target, 'utf8');
  } catch {
    return null;
  }
};

const before = read();
const result = spawnSync(process.execPath, [tsxBin, 'packages/shared/scripts/copy-abis.ts'], {
  stdio: 'inherit',
});
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
