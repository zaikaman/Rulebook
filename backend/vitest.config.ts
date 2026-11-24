import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These route tests run real migrations against PGlite. A cold WASM database start can
    // exceed Vitest's 5 second default on the shared CI runner even though the queries are fast.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
