/**
 * @rulebook/shared — generated Workflow V2 ABIs, per-chain config, boundary schemas, the
 * workflow program encoder, and the Rulewright protocol.
 */
export * from './chains.js';
export * from './schemas.js';
export * from './telegram.js';
export * from './workflows.js';
export * from './workflowValidation.js';
export * from './workflowFields.js';
export * from './workflowsV2.js';
export * from './workflowHealth.js';
export * from './workflowLifecycle.js';
export * from './workflowV2Draft.js';
export * from './workflowV2Recipes.js';
export * from './poolPrice.js';
export * from './workflowV2Simulator.js';
export * from './rulewright.js';
export * from './assistant.js';
export * from './demo.js';
export {
  abis,
  workflowAgentV2Abi,
  workflowAgentFactoryV2Abi,
  workflowVaultV2Abi,
  workflowVaultFactoryV2Abi,
  workflowProgramValidatorV2Abi,
} from './abi/index.js';
export { systemContractAbi } from './abi/system.js';
export { executionCreditAbi } from './abi/credit.js';
export {
  EXECUTION_ESTIMATED_GAS_PER_RUN,
  MAX_DISPLAYED_RUNWAY_RUNS,
  WATCHING_ESTIMATED_GAS_PER_RUN,
  estimateCreditRunway,
  estimateRunCostWei,
  estimatedGasPerRun,
  estimatedGasPerRunLabel,
  feeCreditWarningThreshold,
  formatRunwayRuns,
  type CreditRunwayEstimate,
  type FeeCreditKind,
} from './feeCredit.js';

export const SHARED_PACKAGE_VERSION = '0.1.0';
