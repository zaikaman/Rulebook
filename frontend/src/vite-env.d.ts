/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_LASNA_RPC_URL: string;
  readonly VITE_UNICHAIN_RPC_URL: string;
  readonly VITE_UNICHAIN_WALLET_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID: string;
  readonly VITE_AGENT_FACTORY_ADDRESS?: string;
  readonly VITE_PREVIOUS_AGENT_FACTORY_ADDRESS?: string;
  readonly VITE_VAULT_FACTORY_ADDRESS?: string;
  readonly VITE_PREVIOUS_VAULT_FACTORY_ADDRESS?: string;
  readonly VITE_PREVIOUS_VAULT_FACTORY_ADDRESSES?: string;
  readonly VITE_ENABLE_CHAIN_ONLY_PROOF?: string;
  readonly VITE_ENABLE_MIRROR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
