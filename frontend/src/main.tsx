import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

import { AppRouter } from './app/router.js';
import { queryClient } from './lib/queryClient.js';
import { wagmiConfig } from './lib/wagmi.js';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppRouter />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
