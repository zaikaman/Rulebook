#!/usr/bin/env node
/**
 * Sends the owner a Telegram ping once per verified change set.
 *
 * The agent `Stop` hook runs this right after `verify-changes.mjs`, so the ping is deterministic
 * instead of depending on the model remembering to send it. A stamp inside the git directory
 * keeps it to one message per change set, and nothing is sent for a tree that has not passed the
 * gate or has not changed since the last ping.
 *
 * Wired from `.codex/hooks.json` (Codex) and `.agents/hooks.json` (Antigravity). Antigravity
 * requires a JSON object on stdout, so `--json` keeps every human-readable line on stderr and
 * ends with `{}`; Codex ignores stdout either way.
 *
 * The delivery itself lives in `backend/scripts/notify-agent-done.ts`, which reads the bot token
 * and the database credentials from `backend/.env`. This wrapper never blocks the turn: delivery
 * problems are reported and retried at the next finished task.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { absoluteGitDir, computeChangeSet } from './change-set.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsonOutput = process.argv.includes('--json');

/** Diagnostics go to stderr so the stdout JSON contract stays intact. */
function log(message) {
  console.error(message);
}

function finish(message) {
  if (message) log(message);
  if (jsonOutput) process.stdout.write('{}\n');
  process.exit(0);
}

function readStamp(path) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

const gitDir = absoluteGitDir({ cwd: repoRoot });
const { state, hasChanges } = computeChangeSet({ cwd: repoRoot });

if (!hasChanges) finish();

if (
  readStamp(join(gitDir, 'verify-stamp')) !== state &&
  readStamp(join(gitDir, 'verify-fast-stamp')) !== state
) {
  finish('Not sending the completion ping: this change set has not passed verification.');
}

if (readStamp(join(gitDir, 'notify-stamp')) === state) finish();

log('Sending the completion ping for this change set...');
// npm.cmd needs cmd.exe on Windows; the command and arguments are fixed literals.
const windows = process.platform === 'win32';
const npm = windows ? 'npm.cmd' : 'npm';
const result = spawnSync(
  windows ? `${npm} run notify:done` : npm,
  windows ? [] : ['run', 'notify:done'],
  { cwd: repoRoot, stdio: ['ignore', process.stderr, process.stderr], shell: windows },
);

if (result.error) {
  finish(`The completion ping could not be started (${result.error.code ?? 'unknown'}).`);
}

if (result.status !== 0) {
  finish('The completion ping was not delivered; the next finished task will retry it.');
}

writeFileSync(join(gitDir, 'notify-stamp'), `${state}\n`);
finish();
