import { defineConfig } from 'vitest/config';

/**
 * Vite 5's builtin list predates `node:sqlite`; externalise it explicitly so
 * Vitest does not try to resolve it as a package during test collection.
 */
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
    server: {
      deps: {
        external: ['node:sqlite', 'sqlite'],
      },
    },
  },
  ssr: {
    external: ['node:sqlite', 'sqlite'],
  },
});
