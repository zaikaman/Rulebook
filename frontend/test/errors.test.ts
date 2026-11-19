// @vitest-environment node

import { readFileSync } from 'node:fs';
import { toFunctionSelector } from 'viem';
import { expect, it } from 'vitest';

import { humanizeSelector, isRpcRateLimit } from '../src/lib/errors.js';

it.each([
  { code: 429 },
  { status: 429 },
  { code: -32005 },
  { cause: { message: 'Too Many Requests' } },
  {
    code: -32603,
    message: 'Internal JSON-RPC error.',
    data: {
      originalError: {
        message: 'RPC 0x515 Custom eth_sendRawTransaction: Request is being rate limited.',
      },
    },
  },
])('recognizes RPC throttling in %j', (error) => {
  expect(isRpcRateLimit(error)).toBe(true);
});

it.each([
  { code: 4001, message: 'User rejected the request.' },
  { code: -32603, message: 'Internal JSON-RPC error.' },
  { cause: { code: 3, message: 'execution reverted', data: '0x82b42900' } },
])('keeps unrelated failures separate from RPC throttling in %j', (error) => {
  expect(isRpcRateLimit(error)).toBe(false);
});

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
