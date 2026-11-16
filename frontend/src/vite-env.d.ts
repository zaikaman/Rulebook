/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_LASNA_RPC_URL: string;
  readonly VITE_UNICHAIN_RPC_URL: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID: string;
  readonly VITE_ENABLE_CHAIN_ONLY_PROOF?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
