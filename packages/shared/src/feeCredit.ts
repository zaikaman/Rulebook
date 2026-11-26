import { parseEther } from 'viem';
import { CHAIN_CONFIGS, isAutomationChain } from './chains.js';

/** Credit below this amount is considered low for the corresponding network. */
export function feeCreditWarningThreshold(chainId: number): bigint {
  const mainnet = CHAIN_CONFIGS.get(chainId)?.network === 'mainnet';
  if (isAutomationChain(chainId)) {
    return parseEther(mainnet ? '0.5' : '0.05');
  }
  return parseEther(mainnet ? '0.001' : '0.0001');
}
