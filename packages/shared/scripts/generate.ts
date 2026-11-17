#!/usr/bin/env node
/**
 * Generates every derived copy of the template catalog from `manifest/templates.json`:
 * the typed TS catalog, the Solidity `TemplateCatalog` constants, `docs/catalog.md`, and the
 * template test fixtures. Output is deterministic so a second run is byte-identical.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');

export type SlotKind =
  'schedule' | 'amount' | 'token' | 'price' | 'percent' | 'duration' | 'address';
export type TemplateCategory = 'trading' | 'personal' | 'alert';

export interface ManifestSlot {
  key: string;
  kind: SlotKind;
  label: string;
  required: boolean;
  min: string | null;
  max: string | null;
  unit: string | null;
}

export interface ManifestTemplate {
  id: number;
  name: string;
  category: TemplateCategory;
  trigger: string;
  condition: string;
  action: string;
  sentence: string;
  caveat: string | null;
  slots: ManifestSlot[];
}

export interface Manifest {
  version: number;
  templates: ManifestTemplate[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

const SLOT_KINDS: SlotKind[] = [
  'schedule',
  'amount',
  'token',
  'price',
  'percent',
  'duration',
  'address',
];
const CATEGORIES: TemplateCategory[] = ['trading', 'personal', 'alert'];
const TOKEN_IN = '0x31d0220469e10c4E71834a79b1f276d740d3768F';
const TOKEN_OUT = '0x4200000000000000000000000000000000000006';
const GENERIC_ADDRESS = '0x1111111111111111111111111111111111111111';

/** Parses and validates the manifest, throwing on any structural problem. */
export function loadManifest(path = join(PACKAGE_ROOT, 'manifest', 'templates.json')): Manifest {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  validateManifest(manifest);
  return manifest;
}

/** Structural checks the catalog must pass before anything is generated from it. */
export function validateManifest(manifest: Manifest): void {
  const seenIds = new Set<number>();
  const seenSlotKeys = new Set<string>();

  manifest.templates.forEach((template, index) => {
    if (template.id !== index + 1) {
      throw new Error(`Template at index ${index} must have id ${index + 1}, got ${template.id}`);
    }
    if (seenIds.has(template.id)) throw new Error(`Duplicate template id ${template.id}`);
    seenIds.add(template.id);
    if (!CATEGORIES.includes(template.category)) {
      throw new Error(`Template ${template.id} has unknown category ${template.category}`);
    }
    if (template.slots.length === 0) throw new Error(`Template ${template.id} has no slots`);

    const localKeys = new Set<string>();
    for (const slot of template.slots) {
      if (localKeys.has(slot.key)) {
        throw new Error(`Template ${template.id} repeats slot ${slot.key}`);
      }
      localKeys.add(slot.key);
      seenSlotKeys.add(slot.key);
      if (!SLOT_KINDS.includes(slot.kind)) {
        throw new Error(`Template ${template.id} slot ${slot.key} has unknown kind ${slot.kind}`);
      }
    }

    const placeholders = [...template.sentence.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]);
    for (const placeholder of placeholders) {
      if (!localKeys.has(placeholder ?? '')) {
        throw new Error(`Template ${template.id} sentence references missing slot ${placeholder}`);
      }
    }
    for (const key of localKeys) {
      if (!placeholders.includes(key)) {
        throw new Error(`Template ${template.id} slot ${key} is unreachable from its sentence`);
      }
    }
  });

  if (seenIds.size !== 13) throw new Error(`Expected 13 templates, got ${seenIds.size}`);
  if (seenSlotKeys.size === 0) throw new Error('No slot keys defined');
}

function pascal(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function literal(value: unknown): string {
  return JSON.stringify(value);
}

function renderTemplatesTs(manifest: Manifest): string {
  const entries = manifest.templates
    .map((template) => {
      const slots = template.slots
        .map(
          (slot) =>
            `      {\n        key: ${literal(slot.key)},\n        kind: ${literal(slot.kind)},\n` +
            `        label: ${literal(slot.label)},\n        required: ${slot.required},\n` +
            `        min: ${literal(slot.min)},\n        max: ${literal(slot.max)},\n` +
            `        unit: ${literal(slot.unit)},\n      },`,
        )
        .join('\n');
      return (
        `  {\n    id: ${template.id},\n    name: ${literal(template.name)},\n` +
        `    category: ${literal(template.category)},\n    trigger: ${literal(template.trigger)},\n` +
        `    condition: ${literal(template.condition)},\n    action: ${literal(template.action)},\n` +
        `    sentence: ${literal(template.sentence)},\n    caveat: ${literal(template.caveat)},\n` +
        `    slots: [\n${slots}\n    ],\n  },`
      );
    })
    .join('\n');

  const typeIds = manifest.templates.map((template) => template.id).join(' | ');
  const ids = manifest.templates.map((template) => template.id).join(', ');
  const byId = manifest.templates
    .map((template, index) => `  ${template.id}: TEMPLATES[${index}]!,`)
    .join('\n');

  return `// AUTO-GENERATED by packages/shared/scripts/generate.ts from manifest/templates.json.
// Do not edit by hand: run \`npm run generate\`.

export const TEMPLATE_CATEGORIES = ${literal(CATEGORIES)} as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const SLOT_KINDS = ${literal(SLOT_KINDS)} as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export type SlotKey = ${manifest.templates
    .flatMap((template) => template.slots.map((slot) => slot.key))
    .filter((key, index, all) => all.indexOf(key) === index)
    .map((key) => literal(key))
    .join(' | ')};

export type TemplateId = ${typeIds};

export interface TemplateSlot {
  readonly key: SlotKey;
  readonly kind: SlotKind;
  readonly label: string;
  readonly required: boolean;
  readonly min: string | null;
  readonly max: string | null;
  readonly unit: string | null;
}

export interface TemplateDefinition {
  readonly id: TemplateId;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly trigger: string;
  readonly condition: string;
  readonly action: string;
  readonly sentence: string;
  readonly caveat: string | null;
  readonly slots: readonly TemplateSlot[];
}

export const TEMPLATES = [
${entries}
] as const satisfies readonly TemplateDefinition[];

export const TEMPLATE_IDS: readonly TemplateId[] = [${ids}];

export const TEMPLATES_BY_ID = {
${byId}
} as const satisfies Record<TemplateId, TemplateDefinition>;

export function getTemplate(id: number): TemplateDefinition | undefined {
  return TEMPLATES_BY_ID[id as TemplateId];
}
`;
}

function renderTemplateCatalogSol(manifest: Manifest): string {
  const constants = manifest.templates
    .map((template) => `    uint8 internal constant ${pascal(template.name)} = ${template.id};`)
    .join('\n');

  const names = manifest.templates
    .map((template) => `        if (template == ${template.id}) return "${template.name}";`)
    .join('\n');

  const categories = manifest.templates
    .map((template) => `        if (template == ${template.id}) return "${template.category}";`)
    .join('\n');

  const slotCounts = manifest.templates
    .map((template) => `        if (template == ${template.id}) return ${template.slots.length};`)
    .join('\n');

  return `// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

// AUTO-GENERATED by packages/shared/scripts/generate.ts from manifest/templates.json.
// Do not edit by hand: run \`npm run generate\`.

/// @title TemplateCatalog
/// @notice Generated constants for the 13 rule templates. The parity test in
/// contracts/test/unit/TemplateCatalog.t.sol fails if this file drifts from the manifest.
library TemplateCatalog {
    uint8 internal constant TEMPLATE_COUNT = ${manifest.templates.length};

${constants}

    /// @notice True when \`template\` is in the catalog.
    function isKnown(uint8 template) internal pure returns (bool) {
        return template >= 1 && template <= TEMPLATE_COUNT;
    }

    /// @notice Catalog name for \`template\`, or an empty string when unknown.
    function nameOf(uint8 template) internal pure returns (string memory) {
${names}
        return "";
    }

    /// @notice Catalog category for \`template\`, or an empty string when unknown.
    function categoryOf(uint8 template) internal pure returns (string memory) {
${categories}
        return "";
    }

    /// @notice Number of configurable slots for \`template\`.
    function slotCountOf(uint8 template) internal pure returns (uint8) {
${slotCounts}
        return 0;
    }
}
`;
}

/**
 * Counts the cases each template suite declares and emits the generated matrix test.
 * A template with fewer than the three mandated cases (happy, condition-holds, must-not-fire-
 * twice) fails generation, which is what stops a half-added template from shipping.
 */
function renderTemplateMatrix(manifest: Manifest): string {
  const dir = join(REPO_ROOT, 'contracts', 'test', 'templates');
  const counts = new Map<number, number>();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      const match = /^T(\d+)_.*\.t\.sol$/.exec(file);
      if (!match?.[1]) continue;
      const source = readFileSync(join(dir, file), 'utf8');
      counts.set(Number(match[1]), (source.match(/function test_/g) ?? []).length);
    }
  }

  for (const template of manifest.templates) {
    const count = counts.get(template.id) ?? 0;
    if (count < 3) {
      throw new Error(
        `Template ${template.id} (${template.name}) has ${count} test case(s) in ` +
          `contracts/test/templates; the matrix requires 3`,
      );
    }
  }

  const cases = manifest.templates
    .map((template) => `        if (template == ${template.id}) return ${counts.get(template.id)};`)
    .join('\n');

  return `// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

// AUTO-GENERATED by packages/shared/scripts/generate.ts from manifest/templates.json and the
// cases in contracts/test/templates. Do not edit by hand: run \`npm run generate\`.

import {Test} from "forge-std/Test.sol";

/// @title TemplateMatrix
/// @notice How many test cases each template suite declares. Generation fails when a template
/// has fewer than the three mandated cases, so this file cannot describe a half-added template.
library TemplateMatrix {
    uint8 internal constant TEMPLATE_COUNT = ${manifest.templates.length};

    /// @notice Declared cases for \`template\`, or 0 when it has no suite.
    function caseCount(uint8 template) internal pure returns (uint8) {
${cases}
        return 0;
    }
}

/// @notice Fails the build when any template lost a mandated case.
contract MatrixGeneratedTest is Test {
    function test_everyTemplateHasThreeCases() public view {
        for (uint8 template = 1; template <= TemplateMatrix.TEMPLATE_COUNT; ++template) {
            assertGe(TemplateMatrix.caseCount(template), 3, "a template is missing a case");
        }
    }
}
`;
}

function renderCatalogMd(manifest: Manifest): string {
  const rows = manifest.templates
    .map(
      (template) =>
        `| ${template.id} | ${template.name} | ${template.category} | ${template.trigger} | ` +
        `${template.condition} | ${template.action} | ${template.slots.length} |`,
    )
    .join('\n');
  const caveats = manifest.templates
    .filter((template) => template.caveat)
    .map((template) => `- **#${template.id} ${template.name}** — ${template.caveat}`)
    .join('\n');

  return `# Rule template catalog

<!-- AUTO-GENERATED by packages/shared/scripts/generate.ts. Do not edit by hand. -->

Every template is built on one execution model: trigger → condition → action, with values
chosen from fixed slots. Price conditions always compare against the **last traded price**
cached from the most recent \`Sync\`; schedules are approximate windows.

| # | Name | Category | Trigger | Condition | Action | Slots |
|---|---|---|---|---|---|---|
${rows}

## Documented caveats

${caveats}

## Sentence model

Each template exposes a sentence with \`{slot}\` placeholders. The composer fills those
placeholders only from the slot list above, and the encoder maps the same keys onto the
on-chain \`Rule\` struct. There is no free-text, expression, or prompt field.
`;
}

function fixtureValue(slot: ManifestSlot, template: ManifestTemplate): string {
  switch (slot.kind) {
    case 'schedule':
      return '86400';
    case 'amount':
      return slot.key === 'threshold' ? '5000000' : '10000000';
    case 'token':
      return slot.key === 'token_out' ? TOKEN_OUT : TOKEN_IN;
    case 'price':
      return slot.key === 'secondary' && template.id === 12
        ? '2000000000000000000000'
        : '1500000000000000000000';
    case 'percent':
      return '500';
    case 'duration':
      return slot.unit === 'days' ? '30' : '4102444800';
    case 'address':
      return GENERIC_ADDRESS;
    default:
      return GENERIC_ADDRESS;
  }
}

function renderSentence(template: ManifestTemplate, values: Record<string, string>): string {
  return template.sentence.replace(/\{([a-z_]+)\}/g, (_match, key: string) => values[key] ?? '');
}

function renderFixturesTs(manifest: Manifest): string {
  const fixtures = manifest.templates
    .map((template) => {
      const values: Record<string, string> = {};
      for (const slot of template.slots) {
        values[slot.key] = fixtureValue(slot, template);
      }
      return (
        `  {\n    template: ${template.id},\n    name: ${literal(template.name)},\n` +
        `    slots: ${JSON.stringify(values)},\n` +
        `    sentence: ${literal(renderSentence(template, values))},\n  },`
      );
    })
    .join('\n');

  return `// AUTO-GENERATED by packages/shared/scripts/generate.ts from manifest/templates.json.
// One complete draft per template, used by the encoder and template-matrix tests.

export interface TemplateFixture {
  readonly template: number;
  readonly name: string;
  readonly slots: Readonly<Record<string, string>>;
  readonly sentence: string;
}

export const TEMPLATE_FIXTURES: readonly TemplateFixture[] = [
${fixtures}
];
`;
}

/** Builds every generated file without writing anything. */
export function buildOutputs(manifest: Manifest): GeneratedFile[] {
  return [
    {
      path: join(PACKAGE_ROOT, 'src', 'generated', 'templates.ts'),
      content: renderTemplatesTs(manifest),
    },
    {
      path: join(REPO_ROOT, 'contracts', 'src', 'libraries', 'TemplateCatalog.sol'),
      content: renderTemplateCatalogSol(manifest),
    },
    {
      path: join(REPO_ROOT, 'docs', 'catalog.md'),
      content: renderCatalogMd(manifest),
    },
    {
      path: join(REPO_ROOT, 'contracts', 'test', 'templates', 'fixtures.generated.ts'),
      content: renderFixturesTs(manifest),
    },
    {
      path: join(REPO_ROOT, 'contracts', 'test', 'templates', 'Matrix.generated.t.sol'),
      content: renderTemplateMatrix(manifest),
    },
  ];
}

/** Writes every generated file, creating directories as needed. */
export function writeOutputs(outputs: GeneratedFile[]): void {
  for (const output of outputs) {
    mkdirSync(dirname(output.path), { recursive: true });
    writeFileSync(output.path, output.content);
    console.log(`generated ${relative(REPO_ROOT, output.path)}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  writeOutputs(buildOutputs(loadManifest()));
}
