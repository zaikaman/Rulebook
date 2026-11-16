import { getContractAddress, type Address } from 'viem';

/** Local anvil for the onboarding smoke test. Never a public network or a real key. */
export const ANVIL_RPC_URL = 'http://127.0.0.1:8545';
export const ANVIL_CHAIN_ID = 1301;
export const FIXTURE_API_URL = 'http://127.0.0.1:8787';

export const SPONSOR_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
export const SPONSOR_ADDRESS: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const USER_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
export const USER_ADDRESS: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

/** Deployed by the fixture in this order from the sponsor account's nonces 0 and 1. */
export const AGENT_FACTORY_ADDRESS = getContractAddress({
  from: SPONSOR_ADDRESS,
  nonce: 0n,
});
export const VAULT_FACTORY_ADDRESS = getContractAddress({
  from: SPONSOR_ADDRESS,
  nonce: 1n,
});
