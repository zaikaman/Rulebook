// @vitest-environment node

import { readFileSync } from 'node:fs';
import { toFunctionSelector } from 'viem';
import { expect, it } from 'vitest';

import { humanizeSelector } from '../src/lib/errors.js';

it('has a human message for every Solidity custom error', () => {
  const source = readFileSync(
    new URL('../../contracts/src/shared/Errors.sol', import.meta.url),
    'utf8',
  );
  const declarations = [...source.matchAll(/^error\s+(\w+)\(([^)]*)\);/gm)];
  expect(declarations.length).toBeGreaterThan(0);
  for (const [, name, parameters] of declarations) {
    const types = parameters?.split(',').map((parameter) => parameter.trim().split(/\s+/)[0]);
    const signature = `${name}(${types?.join(',') ?? ''})`;
    const selector = toFunctionSelector(signature);
    expect(humanizeSelector(selector), signature).toMatchObject({
      selector,
      message: expect.stringMatching(/\w.{8,}/),
    });
  }
});
