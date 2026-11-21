import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '^/v1/(?:telegram/availability(?:[?]|$)|accounts/[^/]+/telegram(?:[/?]|$))': {
        target: loadEnv(mode, __dirname).VITE_API_BASE_URL ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['test/a11y.test.tsx'],
  },
}));
