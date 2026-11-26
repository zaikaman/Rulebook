import { parseEther } from 'viem';
import { isAutomationChain } from './chains.js';

/** Credit below this amount is considered low for the corresponding network. */
export function feeCreditWarningThreshold(chainId: number): bigint {
  return parseEther(isAutomationChain(chainId) ? '0.05' : '0.0001');
}
