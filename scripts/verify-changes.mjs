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
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function git(args) {
  const result = run('git', args, { encoding: 'buffer' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const gitDir = git(['rev-parse', '--absolute-git-dir']).toString().trim();
const stampPath = join(gitDir, 'verify-stamp');

// Verify everything the push would publish: commits not yet on the upstream branch plus the
// working tree, so a committed change run through pre-push is covered, not skipped.
const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
function resolveBase() {
  for (const candidate of ['@{upstream}', 'origin/main', 'origin/HEAD']) {
    const ref = run('git', ['rev-parse', '--verify', '--quiet', candidate]);
    if (ref.status !== 0) continue;
    const mergeBase = run('git', ['merge-base', 'HEAD', ref.stdout.trim()]);
    return mergeBase.status === 0 ? mergeBase.stdout.trim() : ref.stdout.trim();
  }
  return emptyTree;
}

const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
  .toString()
  .split('\0')
  .filter(Boolean)
  .sort();

const base = resolveBase();
const diffResult = run('git', ['diff', '--binary', base], { encoding: 'buffer' });
if (diffResult.status !== 0) {
  process.stderr.write(diffResult.stderr);
  process.exit(diffResult.status ?? 1);
}
const diff = diffResult.stdout;
const hasChanges = diff.length > 0 || untracked.length > 0;

if (!hasChanges) {
  console.log('Nothing to verify: the branch and working tree match the upstream.');
  process.exit(0);
}

const digest = createHash('sha256').update(diff);
for (const file of untracked) {
  digest.update(`\0${file}\0`);
  digest.update(run('git', ['hash-object', '--', file]).stdout);
}
const state = digest.digest('hex');

let verifiedState;
try {
  verifiedState = readFileSync(stampPath, 'utf8').trim();
} catch {
  verifiedState = '';
}

if (verifiedState === state) {
  console.log('This change set already passed `npm run verify`.');
  process.exit(0);
}

console.log('Running `npm run verify` for the current change set...');
// npm.cmd needs cmd.exe on Windows; the command and arguments are fixed literals.
const verify = run(
  process.platform === 'win32' ? `${npm} run verify` : npm,
  process.platform === 'win32' ? [] : ['run', 'verify'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (verify.status !== 0) {
  console.error(
    '\n`npm run verify` failed, so this change set is not ready: fix the gates above and run',
  );
  console.error('`npm run verify` again. CI runs exactly these gates.');
  // Exit 2 is the blocking code agent turn hooks use to hand the failure back to the model.
  process.exit(2);
}

writeFileSync(stampPath, `${state}\n`);
console.log('`npm run verify` passed for this change set.');
