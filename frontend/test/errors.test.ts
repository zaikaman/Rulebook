// @vitest-environment node

import { readFileSync } from 'node:fs';
import { BaseError, toFunctionSelector } from 'viem';
import { expect, it } from 'vitest';

import {
  describeError,
  formatContractError,
  humanizeSelector,
  isRpcRateLimit,
} from '../src/lib/errors.js';

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

it('has a human message for every Solidity custom error in Errors.sol and V2 contracts', () => {
  const files = [
    '../../contracts/src/shared/Errors.sol',
    '../../contracts/src/workflow/v2/WorkflowProgramV2.sol',
    '../../contracts/src/workflow/v2/WorkflowVaultV2.sol',
    '../../contracts/src/workflow/v2/WorkflowProtocolsV2.sol',
    '../../contracts/src/workflow/v2/WorkflowVaultFactoryV2.sol',
    '../../contracts/src/workflow/v2/WorkflowAgentFactoryV2.sol',
    '../../contracts/src/workflow/v2/WorkflowAgentV2.sol',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const declarations = [...source.matchAll(/^\s*error\s+(\w+)\(([^)]*)\);/gm)];
    expect(declarations.length, file).toBeGreaterThan(0);
    for (const [, name, parameters] of declarations) {
      const types = parameters
        ? parameters
            .split(',')
            .map((parameter) => parameter.trim().split(/\s+/)[0])
            .filter(Boolean)
        : [];
      const signature = `${name}(${types.join(',')})`;
      const selector = toFunctionSelector(signature);
      expect(humanizeSelector(selector), `${file}: ${signature}`).toMatchObject({
        selector,
        message: expect.stringMatching(/\w.{8,}/),
      });
    }
  }
});

it('translates WorkflowProgramV2 InvalidProgram reverts into actionable copy', () => {
  const selector = toFunctionSelector('InvalidProgram()');
  const reverted = new BaseError(
    'The contract function "validateProgram" reverted with the following signature:',
    {
      cause: Object.assign(new BaseError('Execution reverted'), {
        data: { originalError: { data: selector } },
      }),
    },
  );
  expect(describeError(reverted)).toEqual({
    selector,
    message: 'This workflow program violates an on-chain validation rule.',
  });
  expect(formatContractError(reverted, 'Fallback')).toBe(
    'This workflow program violates an on-chain validation rule.',
  );

  const unknownRevert = new BaseError(
    'The contract function "validateProgram" reverted with the following signature:\n0x12345678',
    {
      cause: Object.assign(new BaseError('Execution reverted'), { raw: '0x12345678' }),
    },
  );
  expect(formatContractError(unknownRevert, 'Fallback')).toBe('The contract refused this request.');
});
