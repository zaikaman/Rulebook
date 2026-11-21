import { toFunctionSelector } from 'viem';

type FailureReason = {
  message: string;
  recovery?: 'balances' | 'allowance' | 'limits';
};

const reasons = new Map<string, FailureReason>([
  [
    toFunctionSelector('InvalidAuthorization()'),
    { message: 'The workflow authorization is no longer active.' },
  ],
  [
    toFunctionSelector('NoLongerEligible()'),
    { message: 'The live balances or position no longer meet the workflow checks.' },
  ],
  [
    toFunctionSelector('StaleObservation()'),
    { message: 'The workflow received a stale price observation.' },
  ],
  [toFunctionSelector('DuplicateOrigin()'), { message: 'This payment has already been used.' }],
  [
    toFunctionSelector('CapExceeded()'),
    { message: 'The run exceeded the approved spending limit.', recovery: 'limits' },
  ],
  [
    toFunctionSelector('WeeklyBudgetExceeded()'),
    { message: 'Run would exceed the weekly spending budget', recovery: 'limits' },
  ],
  [
    toFunctionSelector('InvalidMarket()'),
    { message: 'The configured testnet market is unavailable.' },
  ],
  [
    toFunctionSelector('Error(string)'),
    {
      message: 'A token transfer or swap failed. Check the Vault balances and the market.',
      recovery: 'balances',
    },
  ],
  [
    toFunctionSelector('ERC20InsufficientBalance(address,uint256,uint256)'),
    {
      message: 'The wallet or Vault had insufficient tokens.',
      recovery: 'balances',
    },
  ],
  [
    toFunctionSelector('ERC20InsufficientAllowance(address,uint256,uint256)'),
    {
      message: 'The Vault had insufficient token allowance.',
      recovery: 'allowance',
    },
  ],
]);

export const workflowV2FailureReason = (reason: string): FailureReason =>
  reasons.get(reason) ?? { message: 'Settlement returned a contract error.' };
