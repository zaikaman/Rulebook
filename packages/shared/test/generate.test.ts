import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildOutputs, loadManifest, validateManifest } from '../scripts/generate.js';

const manifest = loadManifest();

describe('template manifest', () => {
  it('validates against the generator schema', () => {
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('declares exactly 13 unique template ids', () => {
    const ids = manifest.templates.map((template) => template.id);
    expect(ids).toHaveLength(13);
    expect(new Set(ids).size).toBe(13);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('makes every slot reachable from its sentence', () => {
    for (const template of manifest.templates) {
      const placeholders = [...template.sentence.matchAll(/\{([a-z_]+)\}/g)].map(
        (match) => match[1],
      );
      for (const slot of template.slots) {
        expect(placeholders, `template ${template.id} slot ${slot.key}`).toContain(slot.key);
      }
    }
  });

  it('documents the four caveats the spec calls out', () => {
    const withCaveats = manifest.templates.filter((template) => template.caveat).map((t) => t.id);
    expect(withCaveats).toEqual(expect.arrayContaining([2, 6, 9, 12]));
  });
});

describe('generator', () => {
  it('is idempotent: a second run is byte-identical', () => {
    const first = buildOutputs(loadManifest());
    const second = buildOutputs(loadManifest());
    expect(second).toEqual(first);
  });

  it('committed generated files match a fresh run', () => {
    for (const output of buildOutputs(manifest)) {
      const committed = readFileSync(output.path, 'utf8');
      expect(committed, output.path).toBe(output.content);
    }
  });

  it('emits the Solidity catalog with the manifest count', () => {
    const catalog = buildOutputs(manifest).find((file) =>
      file.path.endsWith('TemplateCatalog.sol'),
    );
    expect(catalog?.content).toContain('TEMPLATE_COUNT = 13');
    expect(catalog?.content).toContain('uint8 internal constant DCA = 1;');
  });
});
