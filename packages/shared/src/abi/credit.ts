import { parseAbi } from 'viem';

/** Reactive Lasna system contract and Unichain Sepolia callback proxy share this interface. */
export const executionCreditAbi = parseAbi([
  'function reserves(address account) view returns (uint256)',
  'function debt(address account) view returns (uint256)',
  'function depositTo(address account) payable',
]);
