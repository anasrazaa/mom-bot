import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/meeting':    { target: 'http://localhost:8000', changeOrigin: true, ws: true },
      '/transcript': { target: 'http://localhost:8000', changeOrigin: true, ws: true },
      '/speaker':    { target: 'http://localhost:8000', changeOrigin: true },
      '/export':     { target: 'http://localhost:8000', changeOrigin: true },
      '/health':     { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
