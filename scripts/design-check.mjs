#!/usr/bin/env node
/**
 * Design-system drift gate.
 *
 * The UI system has three enforceable sources:
 *  1. `frontend/src/styles/tokens.css` owns every value.
 *  2. `frontend/DESIGN.md` describes those values and the component contracts.
 *  3. `frontend/src/ui` owns markup recipes for new surfaces.
 *
 * This script fails when a value, class, or pattern escapes those sources. Existing feature files
 * are listed in `scripts/design-system-baseline.json`; new files must compose `src/ui` instead.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const frontend = join(root, 'frontend');
const tokensPath = join(frontend, 'src/styles/tokens.css');
const designPath = join(frontend, 'DESIGN.md');
const baselinePath = join(root, 'scripts/design-system-baseline.json');

const writeBaseline = process.argv.includes('--write-baseline');
const findings = [];
const fail = (message) => findings.push(message);

/** Files that may keep raw palette values because they are landing-only or generated art. */
const rawColorAllowlist = new Set([
  'frontend/src/styles/theme.css',
  'frontend/src/pages/LandingPage.tsx',
  'frontend/src/components/chrome/Wordmark.tsx',
  'frontend/src/components/chrome/WalletControl.tsx',
]);

const isLandingFile = (relativePath) => relativePath.startsWith('frontend/src/components/landing/');

function walk(directory) {
  const entries = [];
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) entries.push(...walk(path));
    else entries.push(path);
  }
  return entries;
}

const sourceFiles = walk(join(frontend, 'src'));
const relativePath = (path) => relative(root, path).split(sep).join('/');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const trimLine = (text, index) => {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end).trim();
};

if (!existsSync(tokensPath)) fail('frontend/src/styles/tokens.css is missing.');
if (!existsSync(designPath)) fail('frontend/DESIGN.md is missing.');
if (findings.length) {
  for (const finding of findings) console.error(`FAIL  ${finding}`);
  process.exit(1);
}

const tokensSource = readFileSync(tokensPath, 'utf8');
const tokens = new Map();
for (const match of tokensSource.matchAll(/^\s*(--rb-[a-z0-9-]+):\s*([^;]+);/gm)) {
  tokens.set(match[1], match[2].trim());
}
const colorValues = new Set(
  [...tokens.values()].filter((value) => /^(?:oklch|rgba?|hsla?|#)/i.test(value)),
);

// 1. DESIGN.md must describe current token values and point at real files.
const design = readFileSync(designPath, 'utf8');
const colorBlock = design.match(/^colors:\n((?: {2}[^\n]*\n)+)/m)?.[1] ?? '';
const designColors = [...colorBlock.matchAll(/^ {2}([a-z0-9-]+): '([^']+)'/gm)].map(
  ([, key, value]) => ({ key, value }),
);
if (designColors.length === 0) fail('frontend/DESIGN.md has no machine-readable colors block.');

for (const { key, value } of designColors) {
  if (key.startsWith('landing-')) continue;
  if (!colorValues.has(value)) {
    fail(
      `DESIGN.md color "${key}" is ${value}, which no --rb token in tokens.css defines. ` +
        'Refresh DESIGN.md or add the token.',
    );
  }
}

for (const match of design.matchAll(/^\s*(?:Map|Full):\s+(\S+)/gm)) {
  const target = resolve(frontend, match[1]);
  if (!existsSync(target)) {
    fail(`DESIGN.md references ${match[1]}, but that path does not exist under frontend/.`);
  }
}

// 2. Palette literals belong in tokens.css, not in shared styles or components.
const colorPattern = /#[0-9a-fA-F]{3,8}\b|(?:oklch|rgba?|hsla?)\(/g;
for (const file of sourceFiles) {
  if (!/\.(?:tsx?|css)$/.test(file)) continue;
  const path = relativePath(file);
  if (path === 'frontend/src/styles/tokens.css') continue;
  if (rawColorAllowlist.has(path) || isLandingFile(path)) continue;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(colorPattern)) {
    fail(
      `${path}:${lineOf(text, match.index)} raw palette value "${trimLine(text, match.index)}". ` +
        'Use a var(--rb-*) token or color-mix with one.',
    );
  }
}

// 3. Every rb-* class in TSX must exist in a stylesheet.
const definedClasses = new Set();
for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.css'))) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\.(rb-[a-zA-Z0-9_-]+)/g)) definedClasses.add(match[1]);
}
const classPattern = /(?<![\w-])rb-[a-zA-Z0-9_-]+\b/g;
const rawClassFiles = new Set();
for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.tsx'))) {
  const path = relativePath(file);
  const text = readFileSync(file, 'utf8');
  const classes = new Set([...text.matchAll(classPattern)].map((match) => match[0]));
  if (classes.size > 0) rawClassFiles.add(path);
  for (const className of classes) {
    if (!definedClasses.has(className)) {
      const index = text.indexOf(className);
      fail(`${path}:${lineOf(text, index)} uses .${className}, which no stylesheet defines.`);
    }
  }
}

// 4. New feature files compose src/ui instead of writing their own rb-* recipes.
if (writeBaseline) {
  const baseline = {
    note: 'Generated by npm run check:design -- --write-baseline. Remove entries as files migrate to src/ui.',
    allowedRawClassFiles: [...rawClassFiles]
      .filter((path) => !path.startsWith('frontend/src/ui/'))
      .sort(),
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Wrote ${relativePath(baselinePath)} with ${baseline.allowedRawClassFiles.length} legacy files.`,
  );
  process.exit(0);
}

let allowedRawClassFiles = [];
if (existsSync(baselinePath)) {
  try {
    allowedRawClassFiles =
      JSON.parse(readFileSync(baselinePath, 'utf8')).allowedRawClassFiles ?? [];
  } catch {
    fail('scripts/design-system-baseline.json is not valid JSON.');
  }
}
const allowed = new Set(allowedRawClassFiles);
for (const path of rawClassFiles) {
  if (path.startsWith('frontend/src/ui/')) continue;
  if (!allowed.has(path)) {
    fail(
      `${path} writes raw rb-* classes. Compose a primitive from frontend/src/ui instead, ` +
        'or add the file to the reviewed baseline.',
    );
  }
}

if (findings.length) {
  for (const finding of findings) console.error(`FAIL  ${finding}`);
  console.error(`\n${findings.length} design-system violation(s).`);
  process.exit(1);
}

console.log(
  `Design system clean: ${tokens.size} tokens, ${definedClasses.size} classes, ` +
    `${rawClassFiles.size} raw-class files, ${allowed.size} reviewed legacy files.`,
);
