import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Workspace packages ship TypeScript source, so they're bundled rather than externalized.
const bundled = ['@keybroker/core', '@keybroker/proxy', '@keybroker/agent-api'];

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: bundled } },
  },
  preload: {
    build: { externalizeDeps: { exclude: bundled } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  },
});
