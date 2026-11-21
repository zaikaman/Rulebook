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
export * from './workflowsV2.js';
export * from './workflowV2Draft.js';
export * from './workflowV2Recipes.js';
export * from './rulewright.js';
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
  workflowAgentV2Abi,
  workflowAgentFactoryV2Abi,
  workflowVaultV2Abi,
  workflowVaultFactoryV2Abi,
  workflowProgramValidatorV2Abi,
} from './abi/index.js';
export { systemContractAbi } from './abi/system.js';
export { executionCreditAbi } from './abi/credit.js';
export { feeCreditWarningThreshold } from './feeCredit.js';

export const SHARED_PACKAGE_VERSION = '0.1.0';
