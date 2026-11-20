/**
 * @rulebook/shared — generated ABIs, per-chain config, the 13-template manifest, boundary
 * schemas, and the one rule encoder.
 */
export * from './chains.js';
export * from './encode.js';
export * from './generated/templates.js';
export * from './schemas.js';
export * from './telegram.js';
export * from './workflows.js';
export {
  agentAbi,
  agentFactoryAbi,
  abis,
  ruleRegistryAbi,
  vaultAbi,
  vaultFactoryAbi,
  workflowAgentAbi,
  workflowVaultAbi,
  workflowDirectoryAbi,
  workflowVaultFactoryAbi,
} from './abi/index.js';
export { systemContractAbi } from './abi/system.js';
export { executionCreditAbi } from './abi/credit.js';
export { feeCreditWarningThreshold } from './feeCredit.js';

export const SHARED_PACKAGE_VERSION = '0.1.0';
