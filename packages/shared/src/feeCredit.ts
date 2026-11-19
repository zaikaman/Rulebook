import { parseEther } from 'viem';
import { LASNA_CHAIN_ID } from './chains.js';

/** Credit below this amount is considered low for the corresponding network. */
export function feeCreditWarningThreshold(chainId: number): bigint {
  return parseEther(chainId === LASNA_CHAIN_ID ? '0.05' : '0.0001');
}
