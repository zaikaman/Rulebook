#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveFoundryBinary } from './foundry-env.mjs';

// Coverage is enforced with thresholds, not an exact measurement snapshot. Foundry's
// branch instrumentation counts differ between toolchain releases, so a committed
// percentage cannot reproduce on both the CI-pinned version and a newer local one.
// The committed summary states the floor every shipped source file must clear instead.
const summaryUrl = new URL('../contracts/.coverage-summary.json', import.meta.url);
const summary = JSON.parse(readFileSync(summaryUrl, 'utf8'));
const floors = summary.contracts ?? {};
const isPercent = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const configErrors = [];
if (!isPercent(summary.minimumLinePercent)) configErrors.push('minimumLinePercent');
if (!isPercent(summary.minimumBranchPercent)) configErrors.push('minimumBranchPercent');
for (const [file, floor] of Object.entries(floors)) {
  if (typeof floor !== 'object' || floor === null) {
    configErrors.push(`${file} (floor must be an object)`);
    continue;
  }
  for (const [key, value] of Object.entries(floor)) {
    if (key !== 'minimumLinePercent' && key !== 'minimumBranchPercent') {
      configErrors.push(`${file}.${key} (unknown floor)`);
    } else if (!isPercent(value)) {
      configErrors.push(`${file}.${key} (must be a percentage)`);
    }
  }
}
if (configErrors.length) {
  console.error('Invalid coverage floors in .coverage-summary.json:', configErrors);
  process.exit(1);
}
const artifact = new URL('../contracts/', import.meta.url);
const result = spawnSync(
  resolveFoundryBinary('forge', process.env.FORGE_PATH),
  ['coverage', '--report', 'summary', '--ir-minimum'],
  {
    cwd: fileURLToPath(artifact),
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

// `forge coverage --report summary` columns: File, % Lines, % Statements, % Branches, % Funcs.
const coverage = (value) => {
  const match = value?.match(/^(?:\d+(?:\.\d+)?% \((\d+)\/(\d+)\)|N\/A \(0\/0\))$/);
  if (!match) return undefined;
  return { covered: Number(match[1] ?? 0), total: Number(match[2] ?? 0) };
};
const measured = new Map();
for (const line of result.stdout.split(/\r?\n/)) {
  const [, path, lines, , branches] = line.split('|').map((value) => value.trim());
  const file = path?.replaceAll('\\', '/');
  if (!file?.startsWith('src/')) continue;
  const lineCoverage = coverage(lines);
  if (!lineCoverage) continue;
  measured.set(file, { lines: lineCoverage, branches: coverage(branches) });
}

if (measured.size === 0) {
  console.error('No src coverage rows were reported.');
  process.exit(1);
}

const percent = ({ covered, total }) =>
  total === 0 ? 'n/a' : `${Math.round((covered * 1000) / total) / 10}%`;
const meets = (value, minimum) =>
  Boolean(value) && value.total > 0 && value.covered * 100 >= minimum * value.total;

const failures = [];
for (const file of measured.keys()) {
  if (!(file in floors)) {
    failures.push(`${file}: no coverage floor is declared in .coverage-summary.json`);
  }
}
for (const [file, floor] of Object.entries(floors)) {
  const value = measured.get(file);
  if (!value) {
    failures.push(`${file}: a floor is declared but the file was not measured`);
    continue;
  }
  if (floor.minimumLinePercent !== undefined && !meets(value.lines, floor.minimumLinePercent)) {
    failures.push(
      `${file}: ${percent(value.lines)} line coverage is below the ${floor.minimumLinePercent}% floor`,
    );
  }
  if (
    floor.minimumBranchPercent !== undefined &&
    !meets(value.branches, floor.minimumBranchPercent)
  ) {
    failures.push(
      `${file}: ${percent(value.branches)} branch coverage is below the ${floor.minimumBranchPercent}% floor`,
    );
  }
}

const total = { lines: { covered: 0, total: 0 }, branches: { covered: 0, total: 0 } };
for (const value of measured.values()) {
  total.lines.covered += value.lines.covered;
  total.lines.total += value.lines.total;
  if (value.branches?.total) {
    total.branches.covered += value.branches.covered;
    total.branches.total += value.branches.total;
  }
}
if (!meets(total.lines, summary.minimumLinePercent)) {
  failures.push(
    `src: ${percent(total.lines)} line coverage is below the ${summary.minimumLinePercent}% floor`,
  );
}
if (!meets(total.branches, summary.minimumBranchPercent)) {
  failures.push(
    `src: ${percent(total.branches)} branch coverage is below the ${summary.minimumBranchPercent}% floor`,
  );
}

for (const [file, value] of measured) {
  console.log(`${file}: ${percent(value.lines)} lines, ${percent(value.branches)} branches`);
}
console.log(
  `src: ${percent(total.lines)} line coverage, ${percent(total.branches)} branch coverage across ${measured.size} contracts`,
);

if (failures.length) {
  console.error('Coverage floors not met:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`${tests.passed} contract tests passed with zero skipped.`);
