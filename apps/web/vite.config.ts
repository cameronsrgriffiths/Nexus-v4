import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/healthz': SERVER_URL,
      '/api': SERVER_URL,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
