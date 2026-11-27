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
  [
    toFunctionSelector('CrossingAlreadySettled()'),
    { message: 'This price crossing was already settled by an earlier run.' },
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
  [toFunctionSelector('InvalidMarket()'), { message: 'The configured market is unavailable.' }],
  [
    toFunctionSelector('OracleUnavailable()'),
    { message: 'The Chainlink price oracle is unavailable or stale.' },
  ],
  [
    toFunctionSelector('SequencerUnavailable()'),
    { message: 'The L2 sequencer is down or still in its recovery grace period.' },
  ],
  [
    toFunctionSelector('OraclePriceDeviation(uint256,uint256)'),
    { message: 'The origin pool price diverged too far from the settlement oracle price.' },
  ],
  [
    toFunctionSelector('SlippageExceeded(uint256,uint256)'),
    { message: 'The swap quote was worse than the oracle-protected slippage floor.' },
  ],
  [
    toFunctionSelector('Error(string)'),
    {
      message: 'A token transfer or swap failed. Check the Vault balances and the market.',
      recovery: 'balances',
    },
  ],
  [
    toFunctionSelector('InsufficientVaultBalance(address,uint256,uint256)'),
    {
      message: 'The Vault did not hold enough of the asset this run needed.',
      recovery: 'balances',
    },
  ],
  [
    toFunctionSelector('InsufficientRefillAllowance(uint256,uint256)'),
    {
      message: 'The owner wallet had no USDC allowance approved for this refill.',
      recovery: 'allowance',
    },
  ],
  [
    toFunctionSelector('InsufficientOwnerBalance(uint256,uint256)'),
    {
      message: 'The owner wallet did not hold enough USDC for this refill.',
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
