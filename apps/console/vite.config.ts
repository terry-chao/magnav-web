import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.MAGNAV_API_PORT ?? '8810';
const pagesBase = process.env.PAGES_BASE ?? '/magnav-web/';
const base = process.env.GITHUB_PAGES === '1' ? (pagesBase.endsWith('/') ? pagesBase : `${pagesBase}/`) : '/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@magnav/protocol': fileURLToPath(
        new URL('../../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 400,
    },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
      '/ws': {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: process.env.GITHUB_PAGES === '1' ? 'dist-pages' : 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
