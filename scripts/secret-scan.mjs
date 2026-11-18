#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Set(
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean),
);

// Public Anvil test accounts 0 and 1. Pin the exceptions to the fixture and the two exact values.
const anvilFixture = 'frontend/e2e/fixtureConfig.ts';
const anvilKeyDigests = new Set([
  '60a09e4357868c1e9b801052726d061c370429f723db84523ed58ac354f6eb8a',
  '095101cf732c298a0ce0320b9de704209cdd8640b70d8fdf4e5be51aa2eb272e',
]);

const detectors = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g],
  ['private key', /\b[\w.-]*private[_-]?key\b["']?\s*[:=]\s*["']?(?:0x)?[\da-f]{64}\b/gi],
  [
    'secret exposed to Vite',
    /\bVITE_[A-Z0-9_]*(?:SERVICE_ROLE|PRIVATE_KEY|SEED_PHRASE|MNEMONIC)[A-Z0-9_]*\b/g,
  ],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,}\b/g],
  [
    'seed phrase',
    /\b[\w.-]*(?:seed[_-]?phrase|mnemonic)\b["']?\s*[:=]\s*["']?[a-z]+(?:[ \t]+[a-z]+){11,23}\b/gi,
  ],
];

let findings = 0;
const checkedOut = new Set(
  execFileSync('git', ['ls-files', '--deleted', '-z'], {
    cwd: root,
    encoding: 'utf8',
  }).split('\0'),
);

for (const path of files) {
  if (checkedOut.has(path)) continue;
  const location = new URL(
    path.split('/').map(encodeURIComponent).join('/'),
    new URL('../', import.meta.url),
  );
  if (!lstatSync(location).isFile()) continue;
  const bytes = readFileSync(location);
  if (bytes.includes(0)) continue;
  const source = bytes.toString('utf8');

  function report(kind, position) {
    const line = source.slice(0, position).split('\n').length;
    console.error(`${path}:${line}: ${kind}`);
    findings++;
  }

  for (const [kind, pattern] of detectors) {
    for (const match of source.matchAll(pattern)) {
      const key = match[0].match(/(?:0x)?[a-f\d]{64}$/i)?.[0];
      if (
        path === anvilFixture &&
        key &&
        anvilKeyDigests.has(createHash('sha256').update(key.toLowerCase()).digest('hex'))
      ) {
        continue;
      }
      report(kind, match.index);
    }
  }

  for (const match of source.matchAll(
    /(["'`])([a-z]+(?:[ \t]+[a-z]+){11,23})\1|^\s*([a-z]+(?:[ \t]+[a-z]+){11,23})\s*$/gm,
  )) {
    const phrase = (match[2] ?? match[3]).replace(/[ \t]+/g, ' ');
    if (validateMnemonic(phrase, wordlist)) report('seed phrase', match.index);
  }
}

if (findings) process.exit(1);
console.log('No secret patterns detected.');
