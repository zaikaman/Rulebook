import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toFunctionSelector } from 'viem';
import { describe, expect, it } from 'vitest';

import { mapContractError } from '../../src/api/middleware/errorMap.js';

function contractErrorSignatures(): string[] {
  const source = readFileSync(
    join(process.cwd(), '..', 'contracts', 'src', 'shared', 'Errors.sol'),
    'utf8',
  );
  return [...source.matchAll(/^error\s+([A-Za-z0-9_]+\([^)]*\));/gm)]
    .map((match) => match[1])
    .filter((signature): signature is string => Boolean(signature));
}

describe('contract error map', () => {
  it('covers every custom error declared in Errors.sol', () => {
    const signatures = contractErrorSignatures();
    expect(signatures.length).toBeGreaterThanOrEqual(24);
    for (const signature of signatures) {
      const selector = toFunctionSelector(signature);
      const mapped = mapContractError(selector);
      expect(mapped, `missing mapping for ${signature}`).not.toBeNull();
      expect(mapped?.selector).toBe(selector);
      expect(mapped?.human.length).toBeGreaterThan(0);
    }
  });

  it('preserves the selector when given full revert data', () => {
    const selector = toFunctionSelector('NotOwner()');
    const mapped = mapContractError(`${selector}${'00'.repeat(32)}`);
    expect(mapped?.selector).toBe(selector);
    expect(mapped?.human).toMatch(/owner/i);
  });

  it('returns null for an unknown selector rather than inventing a message', () => {
    expect(mapContractError('0xdeadbeef')).toBeNull();
    expect(mapContractError('not-hex')).toBeNull();
  });
});
