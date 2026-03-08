import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'app'),
  build: {
    outDir: resolve(__dirname, '../../dist/dashboard'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3838',
    },
  },
});
