#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The V2 compiler needs viaIR, so coverage runs with Foundry's ir-minimum profile.
const minimumLinePercent = 80;
const minimumBranchPercent = 55;
const sourcePrefix = 'src/workflow/v2/';
const artifact = new URL('../contracts/.coverage-summary.json', import.meta.url);
const result = spawnSync(
  process.env.FORGE_PATH ?? 'forge',
  ['coverage', '--report', 'summary', '--ir-minimum'],
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

const coverage = (value) => {
  const match = value?.match(/^(?:\d+(?:\.\d+)?% \((\d+)\/(\d+)\)|N\/A \(0\/0\))$/);
  if (!match) return undefined;
  return { covered: Number(match[1] ?? 0), total: Number(match[2] ?? 0) };
};
const sum = { lines: { covered: 0, total: 0 }, branches: { covered: 0, total: 0 } };
for (const line of result.stdout.split(/\r?\n/)) {
  const [, path, statements, , branches] = line.split('|').map((value) => value.trim());
  if (!path?.startsWith(sourcePrefix)) continue;
  const lineCoverage = coverage(statements);
  if (lineCoverage) {
    sum.lines.covered += lineCoverage.covered;
    sum.lines.total += lineCoverage.total;
  }
  const branchCoverage = coverage(branches);
  if (branchCoverage) {
    sum.branches.covered += branchCoverage.covered;
    sum.branches.total += branchCoverage.total;
  }
}

if (!sum.lines.total || !sum.branches.total) {
  console.error('No V2 source coverage rows were reported.');
  process.exit(1);
}

const percent = ({ covered, total }) => Math.round((covered * 1000) / total) / 10;
const lines = percent(sum.lines);
const branches = percent(sum.branches);
console.log(`src/workflow/v2: ${lines}% line coverage, ${branches}% branch coverage`);
if (lines < minimumLinePercent || branches < minimumBranchPercent) {
  console.error(
    `V2 contracts require at least ${minimumLinePercent}% line and ${minimumBranchPercent}% branch coverage.`,
  );
  process.exit(1);
}

const summary = `${JSON.stringify(
  { minimumLinePercent, minimumBranchPercent, tests, lines, branches },
  null,
  2,
)}\n`;
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
