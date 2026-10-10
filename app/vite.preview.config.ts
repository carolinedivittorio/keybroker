// Serves the renderer alone with sample data (src/renderer/src/dev-stub.ts), for UI work in a browser.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  server: { port: 5199, strictPort: true, fs: { allow: [resolve(__dirname, '..')] } },
});
