#!/usr/bin/env node
/**
 * Runs `npm run verify` once per change set.
 *
 * Git hooks and agent turn-end hooks call this so an agent cannot finish, and code cannot be
 * pushed, while the change set fails the same gates CI runs. The digest covers every commit the
 * push would publish plus all uncommitted and untracked content, so editing anything after a
 * green run requires another run. The stamp lives inside the git directory, which keeps it local
 * and out of the repository.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { absoluteGitDir, computeChangeSet, run } from './change-set.mjs';
import { ensureFoundryOnPath } from './foundry-env.mjs';

ensureFoundryOnPath();

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const fast = process.argv.includes('--fast');
const verifyScript = fast ? 'verify:fast' : 'verify';

const stampPath = join(absoluteGitDir(), fast ? 'verify-fast-stamp' : 'verify-stamp');
const fullStampPath = join(absoluteGitDir(), 'verify-stamp');
const { state, hasChanges } = computeChangeSet();

if (!hasChanges) {
  console.log('Nothing to verify: the branch and working tree match the upstream.');
  process.exit(0);
}

function readStamp(path) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

if (readStamp(stampPath) === state || (fast && readStamp(fullStampPath) === state)) {
  console.log(`This change set already passed \`npm run ${verifyScript}\`.`);
  process.exit(0);
}

console.log(`Running \`npm run ${verifyScript}\` for the current change set...`);
// npm.cmd needs cmd.exe on Windows; the command and arguments are fixed literals.
const verify = run(
  process.platform === 'win32' ? `${npm} run ${verifyScript}` : npm,
  process.platform === 'win32' ? [] : ['run', verifyScript],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (verify.status !== 0) {
  console.error(
    `\n\`npm run ${verifyScript}\` failed, so this change set is not ready: fix the gates above and run`,
  );
  console.error(`\`npm run ${verifyScript}\` again.`);
  // Exit 2 is the blocking code agent turn hooks use to hand the failure back to the model.
  process.exit(2);
}

writeFileSync(stampPath, `${state}\n`);
console.log(`\`npm run ${verifyScript}\` passed for this change set.`);
