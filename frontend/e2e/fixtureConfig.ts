import { getContractAddress, type Address } from 'viem';

/** Local anvils for the workflow smoke tests. Never a public network or a real key. */
export const ANVIL_RPC_PORT = Number(process.env.RULEBOOK_E2E_RPC_PORT ?? 8545);
export const ANVIL_RPC_URL = `http://127.0.0.1:${ANVIL_RPC_PORT}`;
export const ANVIL_CHAIN_ID = 1301;
export const ANVIL_BASE_RPC_PORT = Number(process.env.RULEBOOK_E2E_BASE_RPC_PORT ?? 8546);
export const ANVIL_BASE_RPC_URL = `http://127.0.0.1:${ANVIL_BASE_RPC_PORT}`;
export const ANVIL_BASE_CHAIN_ID = 84532;
export const ANVIL_LASNA_RPC_PORT = Number(process.env.RULEBOOK_E2E_LASNA_RPC_PORT ?? 8547);
export const ANVIL_LASNA_RPC_URL = `http://127.0.0.1:${ANVIL_LASNA_RPC_PORT}`;
export const FIXTURE_API_PORT = Number(process.env.RULEBOOK_E2E_API_PORT ?? 18787);
export const FIXTURE_FRONTEND_PORT = Number(process.env.RULEBOOK_E2E_FRONTEND_PORT ?? 15173);
export const FIXTURE_API_URL = `http://127.0.0.1:${FIXTURE_API_PORT}`;
export const FIXTURE_FRONTEND_URL = `http://localhost:${FIXTURE_FRONTEND_PORT}`;

export const SPONSOR_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
export const SPONSOR_ADDRESS: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const USER_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
export const USER_ADDRESS: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
/** Anvil account 9 is reserved for the persistent demo fixture. */
export const DEMO_ADDRESS: Address = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';

/**
 * Agent factory deploys on Lasna anvil at nonce 3 (after validator at 0, reactModule at 1, and
 * Agent impl at 2); vault factories deploy on each funds anvil at nonce 2 (after validator at 0
 * and Vault impl at 1).
 */
export const WORKFLOW_V2_AGENT_FACTORY_ADDRESS = getContractAddress({
  from: SPONSOR_ADDRESS,
  nonce: 3n,
});
export const WORKFLOW_V2_VAULT_FACTORY_ADDRESS = getContractAddress({
  from: SPONSOR_ADDRESS,
  nonce: 2n,
});
/** Base Sepolia anvil deploys only validator, Vault impl, and WorkflowVaultFactoryV2 from sponsor nonces 0..2. */
export const WORKFLOW_V2_BASE_VAULT_FACTORY_ADDRESS = getContractAddress({
  from: SPONSOR_ADDRESS,
  nonce: 2n,
});
