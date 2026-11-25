#!/usr/bin/env node
/**
 * The change set shared by the verify gate and the completion notifier.
 *
 * "This change set" is everything the current branch would publish: every commit the push would
 * add plus all uncommitted and untracked content. Hashing it gives a stable state id, so the
 * verify gate and the notifier agree on when the tree changed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

export function git(args, options = {}) {
  const result = run('git', args, options);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

export function absoluteGitDir(options = {}) {
  return git(['rev-parse', '--absolute-git-dir'], options).toString().trim();
}

// Most recent commit shared with the upstream branch, so commits the push would publish are part
// of the digest too. Falls back to the empty tree when the branch has no upstream yet.
const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function resolveBase(options) {
  for (const candidate of ['@{upstream}', 'origin/main', 'origin/HEAD']) {
    const ref = run('git', ['rev-parse', '--verify', '--quiet', candidate], options);
    if (ref.status !== 0) continue;
    const mergeBase = run('git', ['merge-base', 'HEAD', ref.stdout.trim()], options);
    return mergeBase.status === 0 ? mergeBase.stdout.trim() : ref.stdout.trim();
  }
  return emptyTree;
}

export function computeChangeSet(options = {}) {
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], options)
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort();

  const base = resolveBase(options);
  const changedTracked = git(['diff', '--name-only', '-z', base], options)
    .toString()
    .split('\0')
    .filter(Boolean);
  const files = [...new Set([...changedTracked, ...untracked])].sort();

  const diffResult = run('git', ['diff', '--binary', base], { ...options, encoding: 'buffer' });
  if (diffResult.status !== 0) {
    process.stderr.write(diffResult.stderr);
    process.exit(diffResult.status ?? 1);
  }
  const diff = diffResult.stdout;
  if (diff.length === 0 && untracked.length === 0) {
    return { state: '', hasChanges: false, base, untracked, files };
  }

  const digest = createHash('sha256').update(diff);
  for (const file of untracked) {
    digest.update(`\0${file}\0`);
    digest.update(run('git', ['hash-object', '--', file], options).stdout);
  }
  return { state: digest.digest('hex'), hasChanges: true, base, untracked, files };
}
