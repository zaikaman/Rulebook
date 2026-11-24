import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

// Third-party code is split into long-lived vendor chunks. They change far less often
// than app code, so browsers keep them cached across releases, and the initial download
// is not dominated by a single file. Wallet SDKs are deliberately absent: they are
// already loaded on demand by wagmi, and naming them here would make them eager.
const vendorChunkRules: ReadonlyArray<readonly [chunk: string, pattern: RegExp]> = [
  ['vendor-react', /^(?:react|react-dom|scheduler|react-router)\//],
  ['vendor-web3', /^(?:viem|ox|abitype|wagmi)\//],
  ['vendor-web3', /^@(?:wagmi|noble|scure|tanstack)\//],
  ['vendor-flow', /^(?:d3-[a-z]+|classcat|zustand)\//],
  ['vendor-flow', /^@xyflow\//],
  ['vendor-zod', /^zod\//],
  ['vendor-icons', /^@hugeicons\//],
  ['vendor-tour', /^driver\.js\//],
];

function vendorChunkFor(moduleId: string): string | undefined {
  const normalized = moduleId.replace(/\\/g, '/');
  const marker = 'node_modules/';
  const index = normalized.indexOf(marker);
  if (index === -1) {
    return undefined;
  }
  const packagePath = normalized.slice(index + marker.length);
  // A dependency nested inside another package belongs to the chunk that loads its
  // parent, so leave it where the importer puts it.
  if (packagePath.includes(marker)) {
    return undefined;
  }
  return vendorChunkRules.find(([, pattern]) => pattern.test(packagePath))?.[0];
}

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
  // Compressed sizes are a report-only statistic; skipping the gzip pass keeps builds fast.
  build: {
    outDir: 'dist',
    sourcemap: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks: vendorChunkFor,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['test/a11y.test.tsx'],
  },
}));
