/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_LASNA_RPC_URL: string;
  readonly VITE_UNICHAIN_RPC_URL: string;
  readonly VITE_UNICHAIN_WALLET_RPC_URL?: string;
  readonly VITE_BASE_SEPOLIA_RPC_URL?: string;
  readonly VITE_BASE_SEPOLIA_WALLET_RPC_URL?: string;
  readonly VITE_REACTIVE_MAINNET_RPC_URL?: string;
  readonly VITE_REACTIVE_MAINNET_WALLET_RPC_URL?: string;
  readonly VITE_UNICHAIN_MAINNET_RPC_URL?: string;
  readonly VITE_UNICHAIN_MAINNET_WALLET_RPC_URL?: string;
  readonly VITE_BASE_MAINNET_RPC_URL?: string;
  readonly VITE_BASE_MAINNET_WALLET_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID: string;
  readonly VITE_AGENT_FACTORY_ADDRESS?: string;
  readonly VITE_VAULT_FACTORY_ADDRESS?: string;
  readonly VITE_ENABLE_CHAIN_ONLY_PROOF?: string;
  readonly VITE_ENABLE_MIRROR?: string;
  readonly VITE_WORKFLOW_DIRECTORY_ADDRESS?: string;
  readonly VITE_WORKFLOW_VAULT_FACTORY_ADDRESS?: string;
  readonly VITE_WORKFLOW_V2_DEPLOYMENT?: string;
  readonly VITE_WORKFLOW_V2_MAINNET_DEPLOYMENT?: string;
  readonly VITE_WORKFLOW_V2_ACTIVATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
