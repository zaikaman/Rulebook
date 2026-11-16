#!/usr/bin/env node
/**
 * Asserts ≥90% branch coverage on every core contract, as required by Constitution II.
 * Runs `forge coverage --report summary` and reads its table rather than trusting a badge.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_CONTRACTS = ['Agent', 'Vault', 'AgentFactory', 'VaultFactory', 'RuleRegistry'];
const MIN_BRANCH_PERCENT = 90;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localForge = path.join(
  REPO_ROOT,
  '.tools',
  'foundry',
  process.platform === 'win32' ? 'forge.exe' : 'forge',
);
const forge = existsSync(localForge) ? localForge : 'forge';

const probe = spawnSync(forge, ['--version'], { stdio: 'ignore', shell: false });
if (probe.status !== 0) {
  console.log('SKIP  coverage-gate (forge not installed)');
  process.exit(0);
}

const result = spawnSync(forge, ['coverage', '--report', 'summary'], {
  cwd: path.join(REPO_ROOT, 'contracts'),
  encoding: 'utf8',
  shell: false,
});
process.stdout.write(result.stdout ?? '');
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

const measured = new Map();
for (const line of (result.stdout ?? '').split(/\r?\n/)) {
  const cells = line.split('|').map((cell) => cell.trim());
  if (cells.length < 6) continue;
  const name = path.basename(cells[1]).replace(/\.sol$/i, '');
  const branch = Number.parseFloat(cells[3].replace('%', ''));
  if (Number.isFinite(branch)) measured.set(name, branch);
}

let failed = false;
for (const contract of CORE_CONTRACTS) {
  const branch = measured.get(contract);
  if (branch === undefined) {
    console.error(`FAIL  ${contract}: no coverage row reported`);
    failed = true;
  } else if (branch < MIN_BRANCH_PERCENT) {
    console.error(`FAIL  ${contract}: ${branch}% branch < ${MIN_BRANCH_PERCENT}%`);
    failed = true;
  } else {
    console.log(`PASS  ${contract}: ${branch}% branch`);
  }
}

process.exit(failed ? 1 : 0);
