#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const minimumBranchPercent = 90;
const coreContracts = [
  'src/agent/Agent.sol',
  'src/agent/AgentFactory.sol',
  'src/registry/RuleRegistry.sol',
  'src/vault/Vault.sol',
  'src/vault/VaultFactory.sol',
];
const artifact = new URL('../contracts/.coverage-summary.json', import.meta.url);
// Foundry's unoptimized coverage compiler measures the existing single-action baseline.
// The main contract test job still runs the Workflow suite with the configured viaIR compiler.
const result = spawnSync(
  process.env.FORGE_PATH ?? 'forge',
  ['coverage', '--report', 'summary', '--skip', 'Workflow'],
  {
    cwd: fileURLToPath(new URL('../contracts/', import.meta.url)),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'error' },
  },
);

if (result.error || result.status !== 0) {
  console.error(result.error?.message ?? result.stderr);
  process.stdout.write(result.stdout ?? '');
  process.exit(result.status || 1);
}

const totals = result.stdout.match(/(\d+) tests passed, (\d+) failed, (\d+) skipped/);
const tests = {
  passed: Number(totals?.[1]),
  failed: Number(totals?.[2]),
  skipped: Number(totals?.[3]),
};
if (!tests.passed || tests.failed !== 0 || tests.skipped !== 0) {
  console.error('Coverage run must pass with zero skipped tests.', tests);
  process.exit(1);
}

const rows = new Map(
  result.stdout.split(/\r?\n/).map((line) => {
    const [, path, , , branch] = line.split('|').map((value) => value.trim());
    return [path?.replaceAll('\\', '/'), branch];
  }),
);
const contracts = {};
let failed = false;
for (const path of coreContracts) {
  const coverage = rows.get(path)?.match(/^(\d+(?:\.\d+)?)% \((\d+)\/(\d+)\)$/);
  if (!coverage || Number(coverage[3]) === 0) {
    console.error(`Missing branch coverage for ${path}`);
    failed = true;
    continue;
  }
  const [, percent, covered, total] = coverage.map(Number);
  contracts[path] = { branchPercent: percent, covered, total };
  console.log(`${path}: ${percent}% branch coverage (${covered}/${total})`);
  if (covered * 100 < minimumBranchPercent * total) failed = true;
}

if (failed) {
  console.error(`Each core contract requires at least ${minimumBranchPercent}% branch coverage.`);
  process.exit(1);
}

const summary = `${JSON.stringify({ minimumBranchPercent, tests, contracts }, null, 2)}\n`;
if (process.argv.includes('--write')) {
  writeFileSync(artifact, summary);
} else {
  const committed = JSON.parse(readFileSync(artifact, 'utf8'));
  if (JSON.stringify(committed) !== JSON.stringify(JSON.parse(summary))) {
    console.error('Coverage summary is stale. Run node scripts/coverage-gate.mjs --write.');
    process.exit(1);
  }
}
console.log(`${tests.passed} contract tests passed with zero skipped.`);
