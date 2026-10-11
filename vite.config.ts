import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:6173',
      '/media': 'http://127.0.0.1:6173',
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
