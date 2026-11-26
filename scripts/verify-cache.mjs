#!/usr/bin/env node
/**
 * Content-addressed per-gate verification cache.
 *
 * Computes deterministic SHA-256 digests over each gate's input file subset (tracked git blob
 * hashes overlaid with modified and untracked working-tree content) plus runtime/toolchain
 * versions, storing passed keys inside `.git/verify-cache/gates.json`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CACHE_SCHEMA_VERSION = 1;
const ROOT = resolve(import.meta.dirname, '..');

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function runGit(args, cwd = ROOT) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function readWorkingDigest(relPath, root = ROOT) {
  const fullPath = join(root, relPath);
  let stat;
  try {
    stat = lstatSync(fullPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isFile()) {
    return sha256Buffer(readFileSync(fullPath));
  }
  if (stat.isSymbolicLink()) {
    return `symlink:${sha256Buffer(Buffer.from(readlinkSync(fullPath), 'utf8'))}`;
  }
  if (stat.isDirectory()) {
    // Dirty submodule or nested git repo: include HEAD, tracked diff, and untracked contents.
    try {
      const head = runGit(['rev-parse', 'HEAD'], fullPath).trim();
      const status = runGit(['status', '--porcelain=v1'], fullPath);
      if (!status.trim()) {
        return `submodule:${head}:clean`;
      }
      const diff = execFileSync('git', ['diff', '--binary'], {
        cwd: fullPath,
        maxBuffer: 64 * 1024 * 1024,
      });
      const untracked = runGit(['ls-files', '--others', '--exclude-standard', '-z'], fullPath)
        .split('\0')
        .filter(Boolean)
        .sort();
      const hash = createHash('sha256')
        .update(head)
        .update('\0')
        .update(status)
        .update('\0')
        .update(diff);
      for (const rel of untracked) {
        hash.update('\0').update(rel).update('\0');
        const subDigest = readWorkingDigest(rel, fullPath);
        if (subDigest) hash.update(subDigest);
      }
      return `submodule:${hash.digest('hex')}`;
    } catch {
      return 'dir';
    }
  }
  return null;
}

/**
 * Captures the current repository file digests (tracked + staged + unstaged + untracked)
 * without mutating the index or invoking separate hash-object processes per file.
 */
export function createRepoSnapshot(root = ROOT) {
  const files = new Map();

  const stageOut = runGit(['ls-files', '--stage', '-z'], root);
  for (const record of stageOut.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const meta = record.slice(0, tab).split(' ');
    const oid = meta[1];
    const relPath = record.slice(tab + 1);
    if (relPath && oid) {
      files.set(relPath, oid);
    }
  }

  const statusOut = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root);
  const tokens = statusOut.split('\0');
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    const relPath = entry.slice(3);
    const hasRenameTarget = x === 'R' || x === 'C' || y === 'R' || y === 'C';
    const oldPath = hasRenameTarget ? tokens[++i] : undefined;
    if (oldPath && oldPath !== relPath) {
      files.delete(oldPath);
    }
    if (!relPath) continue;
    if (y === 'D' || (x === 'D' && y === ' ')) {
      files.delete(relPath);
      continue;
    }
    const digest = readWorkingDigest(relPath, root);
    if (digest === null) {
      files.delete(relPath);
    } else {
      files.set(relPath, digest);
    }
  }

  const sortedPaths = [...files.keys()].sort();

  return {
    files,
    hashSubset(predicate, extraStrings = []) {
      const hash = createHash('sha256');
      for (const relPath of sortedPaths) {
        if (!predicate(relPath)) continue;
        hash.update(relPath);
        hash.update('\0');
        hash.update(files.get(relPath) ?? '');
        hash.update('\n');
      }
      for (const extra of extraStrings) {
        hash.update('\0extra\0');
        hash.update(String(extra));
        hash.update('\n');
      }
      return hash.digest('hex');
    },
  };
}

export function getForgeVersionKey(forgeBinary) {
  try {
    return execFileSync(forgeBinary, ['--version'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function loadGateCache(gitDir) {
  const cachePath = join(gitDir, 'verify-cache', 'gates.json');
  if (!existsSync(cachePath)) {
    return { schemaVersion: CACHE_SCHEMA_VERSION, gates: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.schemaVersion === CACHE_SCHEMA_VERSION &&
      parsed.gates &&
      typeof parsed.gates === 'object'
    ) {
      return parsed;
    }
  } catch {
    // Corrupt cache is treated as empty.
  }
  return { schemaVersion: CACHE_SCHEMA_VERSION, gates: {} };
}

export function saveGateCache(gitDir, data) {
  const cachePath = join(gitDir, 'verify-cache', 'gates.json');
  mkdirSync(dirname(cachePath), { recursive: true });
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ ...data, schemaVersion: CACHE_SCHEMA_VERSION }, null, 2));
  renameSync(tmpPath, cachePath);
}

export const isRootTooling = (path) =>
  path === 'package.json' ||
  path === 'package-lock.json' ||
  path === 'scripts/check.mjs' ||
  path === 'scripts/verify-cache.mjs';

export const matchesContracts = (path) =>
  isRootTooling(path) || path.startsWith('contracts/') || path === 'scripts/foundry-env.mjs';

export const matchesContractsCoverage = (path) =>
  matchesContracts(path) || path === 'scripts/coverage-gate.mjs';

export const matchesGeneratedArtifacts = (path) =>
  matchesContracts(path) ||
  path === 'packages/shared/scripts/copy-abis.ts' ||
  path === 'packages/shared/src/abi/index.ts' ||
  path === 'scripts/generate-check.mjs';

export const matchesBuildShared = (path) =>
  isRootTooling(path) || path.startsWith('packages/shared/');

export const matchesTestShared = matchesBuildShared;

export const matchesBuildBackend = (path) =>
  isRootTooling(path) ||
  path.startsWith('packages/shared/') ||
  (path.startsWith('backend/') && !path.startsWith('backend/test/'));

export const matchesTestBackend = (path) =>
  isRootTooling(path) ||
  path.startsWith('packages/shared/') ||
  path.startsWith('backend/') ||
  path.startsWith('deployments/') ||
  path.startsWith('scripts/');

export const matchesBuildFrontend = (path) =>
  isRootTooling(path) ||
  path.startsWith('packages/shared/') ||
  (path.startsWith('frontend/') && !path.startsWith('frontend/e2e/'));

export const matchesTestFrontend = matchesBuildFrontend;

export const matchesBrowser = (path) =>
  isRootTooling(path) ||
  path === 'playwright.config.ts' ||
  path.startsWith('packages/shared/') ||
  path.startsWith('frontend/') ||
  path.startsWith('backend/src/') ||
  path === 'backend/package.json' ||
  path.startsWith('contracts/') ||
  path.startsWith('deployments/');
